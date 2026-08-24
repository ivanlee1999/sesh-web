import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { verifyThings } from '@/lib/things'
import {
  ThingsConfigError,
  clearThingsConfig,
  readThingsConfigView,
  saveThingsConfig,
} from '@/lib/things-config'

/**
 * The Things connection, editable from Settings on any device.
 *
 * It is stored server-side so every device shares one connection, and the API
 * key is write-only over this route — responses report whether a key is set,
 * never what it is.
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

  const payload = (body ?? {}) as { url?: unknown; apiKey?: unknown }
  if (typeof payload.url !== 'string') {
    return NextResponse.json({ error: 'Enter the Things service URL.' }, { status: 400 })
  }
  // Absent apiKey keeps the stored one; an empty string deliberately clears it.
  if (payload.apiKey !== undefined && typeof payload.apiKey !== 'string') {
    return NextResponse.json({ error: 'API key must be text.' }, { status: 400 })
  }

  let saved
  try {
    saved = saveThingsConfig(payload.url, payload.apiKey as string | undefined)
  } catch (err) {
    if (err instanceof ThingsConfigError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }

  // Saved either way, then probed: a typo should be visible immediately, but a
  // sidecar that is merely still booting must not throw the settings away.
  const reachable = await verifyThings(saved)
  return NextResponse.json({ ...readThingsConfigView(), reachable }, NO_STORE)
}

export async function DELETE(request: Request) {
  const blocked = guard(request)
  if (blocked) return blocked
  clearThingsConfig()
  // Falls back to THINGS_API_URL if the deployment still sets one.
  return NextResponse.json(readThingsConfigView(), NO_STORE)
}
