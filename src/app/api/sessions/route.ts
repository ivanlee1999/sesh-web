import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
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
    db.prepare(`
      INSERT OR IGNORE INTO sessions
        (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes, todoist_task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.id,
      body.intention ?? '',
      body.category ?? 'other',
      body.type ?? 'focus',
      body.targetMs ?? 0,
      body.actualMs ?? 0,
      body.overflowMs ?? 0,
      body.startedAt,
      body.endedAt,
      body.notes ?? '',
      body.todoistTaskId ?? null,
    )
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
