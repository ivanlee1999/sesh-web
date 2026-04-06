import { NextRequest, NextResponse } from 'next/server'
import { syncSessionToGoogleCalendar } from '@/lib/google-calendar'

/**
 * Manual calendar sync endpoint — kept as a retry/debug path.
 * The primary sync now happens server-side inside POST /api/timer
 * and POST /api/sessions.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await syncSessionToGoogleCalendar({
      intention: body.intention,
      category: body.category ?? 'other',
      type: body.type ?? 'focus',
      startedAt: body.startedAt,
      endedAt: body.endedAt,
      targetMs: body.targetMs ?? 0,
      actualMs: body.actualMs ?? 0,
      overflowMs: body.overflowMs ?? 0,
    })

    if (result.error) {
      return NextResponse.json(result, { status: 500 })
    }
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ synced: false, error: String(err) }, { status: 500 })
  }
}
