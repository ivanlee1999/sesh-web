import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import {
  ThingsConfigError,
  clearThingsConfig,
  readThingsConfig,
  readThingsConfigView,
  saveThingsAccount,
  saveThingsConfig,
} from '@/lib/things-config'
import { ThingsAuthError, ThingsCloudError } from '@/lib/things-cloud'
import { ThingsSecretError } from '@/lib/things-secret'
import { checkThings } from '@/lib/things-service'

/**
 * The Things connection, editable from Settings on any device.
 *
 * Two shapes are accepted: `{ email, password }` signs in to Things Cloud
 * directly, and `{ url, apiKey }` points at a companion service. Either is
 * stored server-side so every device shares one connection, and neither the
 * password nor the API key is ever sent back — responses only say whether one
 * is set.
 */

export const dynamic = 'force-dynamic'

/** Connection state must never be answered from a cache. */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

function guard(request: Request) {
  const auth = validateTodoistAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  return null
}

export async function GET(request: Request) {
  const blocked = guard(request)
  if (blocked) return blocked
  return NextResponse.json(readThingsConfigView(), NO_STORE)
}

export async function PUT(request: Request) {
  const blocked = guard(request)
  if (blocked) return blocked

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 })
  }

  const payload = (body ?? {}) as { email?: unknown; password?: unknown; url?: unknown; apiKey?: unknown }

  try {
    if (typeof payload.email === 'string') {
      if (typeof payload.password !== 'string') {
        return NextResponse.json({ error: 'Enter your Things password.' }, { status: 400 })
      }
      // Verifies before storing, so "connected" always means it works.
      await saveThingsAccount(payload.email, payload.password)
      return NextResponse.json({ ...readThingsConfigView(), reachable: true }, NO_STORE)
    }

    if (typeof payload.url === 'string') {
      if (payload.apiKey !== undefined && typeof payload.apiKey !== 'string') {
        return NextResponse.json({ error: 'API key must be text.' }, { status: 400 })
      }
      const saved = saveThingsConfig(payload.url, payload.apiKey as string | undefined)
      // Saved either way, then probed: a typo should be visible immediately,
      // but a service that is merely still booting must not be thrown away.
      const health = await checkThings(saved)
      return NextResponse.json({ ...readThingsConfigView(), ...health }, NO_STORE)
    }

    return NextResponse.json(
      { error: 'Enter the email address for your Things account.' },
      { status: 400 },
    )
  } catch (err) {
    if (err instanceof ThingsAuthError) {
      return NextResponse.json({ error: 'Things did not accept that email and password.' }, { status: 400 })
    }
    if (err instanceof ThingsConfigError || err instanceof ThingsSecretError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof ThingsCloudError) {
      return NextResponse.json({ error: `Could not reach Things: ${err.message}` }, { status: 502 })
    }
    throw err
  }
}

export async function DELETE(request: Request) {
  const blocked = guard(request)
  if (blocked) return blocked
  clearThingsConfig()
  // Falls back to THINGS_API_URL if the deployment still sets one.
  const remaining = readThingsConfig()
  return NextResponse.json(
    { ...readThingsConfigView(), reachable: remaining ? undefined : false },
    NO_STORE,
  )
}
