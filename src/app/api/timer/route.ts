import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

interface TimerRow {
  id: number
  phase: string
  session_type: string
  intention: string
  category: string
  target_ms: number
  remaining_ms: number
  overflow_ms: number
  started_at: number | null
  paused_at: number | null
  updated_at: number
}

function rowToJson(row: TimerRow) {
  return {
    phase: row.phase,
    sessionType: row.session_type,
    intention: row.intention,
    category: row.category,
    targetMs: row.target_ms,
    remainingMs: row.remaining_ms,
    overflowMs: row.overflow_ms,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    updatedAt: row.updated_at,
  }
}

export async function GET() {
  try {
    const db = getDb()
    const row = db.prepare('SELECT * FROM timer_state WHERE id = 1').get() as TimerRow
    return NextResponse.json(rowToJson(row))
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const db = getDb()
    const body = await request.json()
    const now = Date.now()
    db.prepare(`
      UPDATE timer_state SET
        phase = ?, session_type = ?, intention = ?, category = ?,
        target_ms = ?, remaining_ms = ?, overflow_ms = ?,
        started_at = ?, paused_at = ?, updated_at = ?
      WHERE id = 1
    `).run(
      body.phase ?? 'idle',
      body.sessionType ?? 'focus',
      body.intention ?? '',
      body.category ?? 'development',
      body.targetMs ?? 0,
      body.remainingMs ?? 0,
      body.overflowMs ?? 0,
      body.startedAt ?? null,
      body.pausedAt ?? null,
      now,
    )
    const row = db.prepare('SELECT * FROM timer_state WHERE id = 1').get() as TimerRow
    return NextResponse.json(rowToJson(row))
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
