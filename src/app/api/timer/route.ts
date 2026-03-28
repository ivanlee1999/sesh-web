import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
export const dynamic = 'force-dynamic'

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

/**
 * Auto-complete an expired timer atomically.
 * Uses a deterministic session ID (`auto-{started_at}`) and compare-and-swap
 * on started_at so that concurrent callers never create duplicate sessions.
 */
function tryAutoComplete(db: ReturnType<typeof getDb>) {
  const selectTimer = db.prepare('SELECT * FROM timer_state WHERE id = 1')

  const resetTimer = db.prepare(`
    UPDATE timer_state
    SET phase = 'idle', intention = '', remaining_ms = target_ms,
        overflow_ms = 0, started_at = NULL, paused_at = NULL, updated_at = ?
    WHERE id = 1 AND phase = 'running' AND started_at = ?
  `)

  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO sessions
      (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const run = db.transaction(() => {
    const row = selectTimer.get() as TimerRow
    if (!row || row.phase !== 'running' || !row.started_at || row.target_ms <= 0) {
      return { completed: false, row }
    }

    const elapsed = Date.now() - row.started_at
    if (elapsed < row.target_ms) {
      return { completed: false, row }
    }

    const endedAt = Date.now()
    const actualMs = endedAt - row.started_at
    const overflowMs = Math.max(0, actualMs - row.target_ms)
    const sessionId = `auto-${row.started_at}`

    // Compare-and-swap: only reset if started_at still matches
    const result = resetTimer.run(endedAt, row.started_at)
    if (result.changes === 0) {
      // Another request already completed it
      return { completed: false, row: selectTimer.get() as TimerRow }
    }

    insertSession.run(
      sessionId,
      row.intention,
      row.category,
      row.session_type,
      row.target_ms,
      actualMs,
      overflowMs,
      row.started_at,
      endedAt,
      'auto-completed'
    )

    return {
      completed: true,
      row: selectTimer.get() as TimerRow,
      notification: {
        intention: row.intention,
        sessionType: row.session_type,
        targetMs: row.target_ms,
        overflowMs,
      },
    }
  })

  return run()
}

function sendDiscordNotification(notification: {
  intention: string
  sessionType: string
  targetMs: number
  overflowMs: number
}) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  if (!webhookUrl) return

  const duration = Math.round(notification.targetMs / 60000)
  const overflow = Math.round(notification.overflowMs / 60000)
  const msg = notification.intention
    ? `✅ **Session complete:** "${notification.intention}" (${duration}min ${notification.sessionType}${overflow > 0 ? `, +${overflow}min overflow` : ''})`
    : `✅ **${notification.sessionType} session complete** (${duration}min${overflow > 0 ? `, +${overflow}min overflow` : ''})`

  void fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: msg }),
  }).catch(() => {})
}

export async function GET() {
  try {
    const db = getDb()

    // Always check for auto-complete on any GET (not just background)
    const result = tryAutoComplete(db)
    if (result.completed && result.notification) {
      sendDiscordNotification(result.notification)
    }
    return NextResponse.json(rowToJson(result.row))
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

/**
 * Atomic manual completion. Uses compare-and-swap on started_at so that
 * concurrent callers (including the background auto-complete path) never
 * create duplicate sessions.
 */
export async function POST(request: Request) {
  try {
    const db = getDb()
    const body = await request.json()
    const startedAt: number | undefined = body.startedAt

    if (!startedAt) {
      return NextResponse.json({ error: 'startedAt is required' }, { status: 400 })
    }

    const selectTimer = db.prepare('SELECT * FROM timer_state WHERE id = 1')

    const resetTimer = db.prepare(`
      UPDATE timer_state
      SET phase = 'idle', intention = '', remaining_ms = target_ms,
          overflow_ms = 0, started_at = NULL, paused_at = NULL, updated_at = ?
      WHERE id = 1 AND started_at = ?
    `)

    const insertSession = db.prepare(`
      INSERT OR IGNORE INTO sessions
        (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const result = db.transaction(() => {
      const row = selectTimer.get() as TimerRow | undefined
      if (!row || !row.started_at || row.started_at !== startedAt) {
        // Timer already completed by another caller (auto-complete or another client)
        return { completed: false, alreadyDone: true, row: row ?? null }
      }

      const endedAt = Date.now()
      const actualMs = endedAt - row.started_at
      const overflowMs = Math.max(0, actualMs - row.target_ms)
      // Deterministic ID keyed by started_at — same namespace as auto-complete
      const sessionId = `manual-${row.started_at}`

      // Compare-and-swap: only reset if started_at still matches
      const updateResult = resetTimer.run(endedAt, row.started_at)
      if (updateResult.changes === 0) {
        return { completed: false, alreadyDone: true, row: selectTimer.get() as TimerRow }
      }

      insertSession.run(
        sessionId,
        body.intention ?? row.intention,
        body.category ?? row.category,
        row.session_type,
        row.target_ms,
        actualMs,
        overflowMs,
        row.started_at,
        endedAt,
        body.notes ?? '',
      )

      return {
        completed: true,
        alreadyDone: false,
        row: selectTimer.get() as TimerRow,
        session: {
          id: sessionId,
          intention: body.intention ?? row.intention,
          category: body.category ?? row.category,
          type: row.session_type,
          targetMs: row.target_ms,
          actualMs,
          overflowMs,
          startedAt: row.started_at,
          endedAt,
        },
      }
    })()

    if (!result.completed) {
      // Return 200 with completed: false — the session was already saved by another path
      return NextResponse.json({ completed: false })
    }

    // Send Discord notification on manual finish too
    if (result.session) {
      sendDiscordNotification({
        intention: result.session.intention,
        sessionType: result.session.type,
        targetMs: result.session.targetMs,
        overflowMs: result.session.overflowMs,
      })
    }

    return NextResponse.json({
      completed: true,
      timer: result.row ? rowToJson(result.row) : null,
      session: result.session,
    })
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
