import { NextResponse } from 'next/server'
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
  rating: number
  todoist_task_id: string | null
  google_event_id: string
  is_synced: number
}

function rowToJson(row: SessionRow) {
  return {
    id: row.id,
    intention: row.intention,
    category: row.category,
    type: row.type,
    targetMs: row.target_ms,
    actualMs: row.actual_ms,
    overflowMs: row.overflow_ms,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    rating: row.rating ?? 0,
    todoistTaskId: row.todoist_task_id,
  }
}

export async function GET() {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as SessionRow[]
    return NextResponse.json(rows.map(rowToJson))
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const db = getDb()
    const body = await request.json()

    /*
     * Upsert, not INSERT OR IGNORE.
     *
     * The row often already exists by the time this runs: the background
     * auto-completer saves a session as soon as the timer expires, under the
     * same `manual-<startedAt>` id the reflection screen uses. Ignoring the
     * second write silently dropped whatever topic the person had just typed
     * on that screen, and left the calendar event on the old title.
     *
     * Only the fields a person can actually edit are overwritten. Timings come
     * from whoever completed the session and are not the client's to revise.
     */
    db.prepare(`
      INSERT INTO sessions
        (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes, rating, todoist_task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        intention = excluded.intention,
        category = excluded.category,
        notes = excluded.notes,
        rating = excluded.rating,
        todoist_task_id = excluded.todoist_task_id
    `).run(
      body.id,
      body.intention ?? '',
      body.category ?? 'other',
      body.type ?? body.sessionType ?? 'focus',
      body.targetMs ?? 0,
      body.actualMs ?? 0,
      body.overflowMs ?? 0,
      body.startedAt,
      body.endedAt,
      body.notes ?? '',
      Number(body.rating) || 0,
      body.todoistTaskId ?? null,
    )

    // Sync from the stored row: it carries the event id, so an edit updates the
    // existing calendar entry instead of creating a second one beside it.
    const stored = db.prepare('SELECT * FROM sessions WHERE id = ?').get(body.id) as SessionRow | undefined
    const calendar = stored
      ? await syncSessionToGoogleCalendar({
        id: stored.id,
        intention: stored.intention,
        category: stored.category,
        type: stored.type,
        targetMs: stored.target_ms,
        actualMs: stored.actual_ms,
        overflowMs: stored.overflow_ms,
        notes: stored.notes,
        startedAt: stored.started_at,
        endedAt: stored.ended_at,
        googleEventId: stored.google_event_id,
        isSynced: stored.is_synced === 1,
      })
      : undefined
    if (stored && calendar) persistCalendarSyncResult(stored.id, calendar)

    return NextResponse.json({ ok: true, calendar })
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
