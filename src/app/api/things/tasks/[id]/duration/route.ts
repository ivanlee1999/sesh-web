import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { readThingsConfig } from '@/lib/things-config'
import { thingsWriteError } from '@/app/api/things/write-error'
import { recordThingsFocus } from '@/lib/things-service'
import { withIdempotency } from '@/lib/idempotency'

export const dynamic = 'force-dynamic'

/**
 * Things has no duration field, so this records focused time in the task note.
 * Mirrors the Todoist duration route so the client can treat both the same.
 */
async function handlePost(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateTodoistAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const conn = readThingsConfig()
  if (!conn) {
    return NextResponse.json({ error: 'Things not configured' }, { status: 503 })
  }

  // Outside the try: the id names the task in the failure log, so it has to
  // outlive the call that failed.
  const { id } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const minutes = Math.max(1, Math.round(Number(body.add_minutes) || 0))
    await recordThingsFocus(conn, id, minutes)
    return NextResponse.json({ ok: true, minutes })
  } catch (err) {
    return thingsWriteError('duration write', id, err)
  }
}

/**
 * Wrapped so a client that retries after a lost reply does not apply this
 * twice — see lib/idempotency. Unkeyed callers are unaffected.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withIdempotency(request, () => handlePost(request, context))
}
