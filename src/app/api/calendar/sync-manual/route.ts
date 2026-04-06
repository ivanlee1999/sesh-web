import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { syncSessionToGoogleCalendar, persistCalendarSyncResult } from '@/lib/google-calendar'
export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  intention: string
  category: string
  type: string
  target_ms: number
  actual_ms: number
  overflow_ms: number
  started_at: number
  ended_at: number
  notes: string
  todoist_task_id: string | null
  google_event_id: string
  is_synced: number
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const sessionId: string | undefined = body.sessionId
    const limit: number = Math.min(Math.max(body.limit ?? 10, 1), 100)

    const db = getDb()
    let rows: SessionRow[]

    if (sessionId) {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined
      if (!row) {
        return NextResponse.json({ ok: false, error: 'Session not found' }, { status: 404 })
      }
      rows = [row]
    } else {
      rows = db.prepare(`
        SELECT * FROM sessions
        WHERE is_synced = 0
        ORDER BY started_at DESC
        LIMIT ?
      `).all(limit) as SessionRow[]
    }

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        requested: { sessionId, limit },
        results: [],
        syncedCount: 0,
        failedCount: 0,
      })
    }

    const results = await Promise.all(rows.map(async (row) => {
      const result = await syncSessionToGoogleCalendar({
        id: row.id,
        intention: row.intention,
        category: row.category,
        type: row.type,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        targetMs: row.target_ms,
        actualMs: row.actual_ms,
        overflowMs: row.overflow_ms,
        googleEventId: row.google_event_id || undefined,
        isSynced: row.is_synced === 1,
      })
      persistCalendarSyncResult(row.id, result)
      return {
        sessionId: row.id,
        synced: result.synced,
        eventId: result.eventId,
        skipped: result.skipped,
        error: result.error,
      }
    }))

    const syncedCount = results.filter(r => r.synced).length
    const failedCount = results.filter(r => !r.synced && !r.skipped).length

    return NextResponse.json({
      ok: true,
      requested: { sessionId, limit },
      results,
      syncedCount,
      failedCount,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
