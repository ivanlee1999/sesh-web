import { NextResponse } from 'next/server'
import { isTodoistConfigured, addTaskDuration } from '@/lib/todoist'
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
    const body = await request.json()
    const addMinutes = Number(body.add_minutes)

    if (!Number.isFinite(addMinutes) || addMinutes <= 0) {
      return NextResponse.json({ error: 'add_minutes must be a positive number' }, { status: 400 })
    }

    const totalMinutes = await addTaskDuration(id, addMinutes)
    return NextResponse.json({ ok: true, total_minutes: totalMinutes })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
