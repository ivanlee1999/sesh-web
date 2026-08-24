import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { appendThingsFocusNote } from '@/lib/things'
import { readThingsConfig } from '@/lib/things-config'

export const dynamic = 'force-dynamic'

/**
 * Things has no duration field, so this records focused time in the task note.
 * Mirrors the Todoist duration route so the client can treat both the same.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = validateTodoistAuth(request)
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

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const minutes = Math.max(1, Math.round(Number(body.add_minutes) || 0))
    await appendThingsFocusNote(conn, id, minutes)
    return NextResponse.json({ ok: true, minutes })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
