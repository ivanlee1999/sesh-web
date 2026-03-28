import { NextResponse } from 'next/server'
import { isTodoistConfigured, closeTask } from '@/lib/todoist'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  if (!isTodoistConfigured()) {
    return NextResponse.json({ error: 'Todoist not configured' }, { status: 503 })
  }

  try {
    const { id } = await params
    await closeTask(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
