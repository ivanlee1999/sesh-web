import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { syncSessionToGoogleCalendar, persistCalendarSyncResult } from '@/lib/google-calendar'

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

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.trim()
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(params.id) as SessionRow | undefined
    if (!existing) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const body = await request.json()
    const intention = normalizeText(body.intention, existing.intention)
    const category = normalizeText(body.category, existing.category) || existing.category || 'other'
    const notes = typeof body.notes === 'string' ? body.notes.trim() : existing.notes
    const rating = body.rating === undefined ? existing.rating : Math.max(0, Math.min(5, Number(body.rating) || 0))

    db.prepare(`
      UPDATE sessions
      SET intention = ?, category = ?, notes = ?, rating = ?
      WHERE id = ?
    `).run(intention, category, notes, rating, params.id)

    const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(params.id) as SessionRow
    const calendar = await syncSessionToGoogleCalendar({
      id: updated.id,
      intention: updated.intention,
      category: updated.category,
      type: updated.type,
      targetMs: updated.target_ms,
      actualMs: updated.actual_ms,
      overflowMs: updated.overflow_ms,
      notes: updated.notes,
      startedAt: updated.started_at,
      endedAt: updated.ended_at,
      googleEventId: updated.google_event_id,
      isSynced: updated.is_synced === 1,
    })
    persistCalendarSyncResult(updated.id, calendar)

    const refreshed = db.prepare('SELECT * FROM sessions WHERE id = ?').get(params.id) as SessionRow
    return NextResponse.json({ ok: true, session: rowToJson(refreshed), calendar })
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const db = getDb()
    db.prepare('DELETE FROM sessions WHERE id = ?').run(params.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
