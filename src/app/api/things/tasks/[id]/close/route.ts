import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { readThingsConfig } from '@/lib/things-config'
import { thingsWriteError } from '@/app/api/things/write-error'
import { completeThings } from '@/lib/things-service'

export const dynamic = 'force-dynamic'

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

  // Outside the try: the id names the task in the failure log, so it has to
  // outlive the call that failed.
  const { id } = await params

  try {
    await completeThings(conn, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return thingsWriteError('complete', id, err)
  }
}
