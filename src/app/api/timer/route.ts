import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { sendPushToAll } from '@/lib/push'
import { isTodoistConfigured, addTaskDuration } from '@/lib/todoist'
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
  todoist_task_id: string | null
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
    todoistTaskId: row.todoist_task_id,
  }
}

/**
 * Sync Todoist duration after session completion (non-fatal).
 */
async function syncTodoistDuration(todoistTaskId: string, actualMs: number) {
  if (!isTodoistConfigured()) return
  const minutes = Math.round(actualMs / 60000)
  if (minutes <= 0) return
  try {
    await addTaskDuration(todoistTaskId, minutes)
  } catch (err) {
    console.error('[todoist] Failed to sync duration:', err)
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
        overflow_ms = 0, started_at = NULL, paused_at = NULL, updated_at = ?,
        todoist_task_id = NULL
    WHERE id = 1 AND phase = 'running' AND started_at = ?
  `)

  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO sessions
      (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes, todoist_task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      'auto-completed',
      row.todoist_task_id,
    )

    return {
      completed: true,
      row: selectTimer.get() as TimerRow,
      todoistTaskId: row.todoist_task_id,
      actualMs,
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
    ? `\u2705 **Session complete:** "${notification.intention}" (${duration}min ${notification.sessionType}${overflow > 0 ? `, +${overflow}min overflow` : ''})`
    : `\u2705 **${notification.sessionType} session complete** (${duration}min${overflow > 0 ? `, +${overflow}min overflow` : ''})`

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
      await sendPushToAll(
        'sesh \u2014 session complete',
        result.notification.intention || `${result.notification.sessionType} session finished`
      )
      // Todoist sync outside transaction, non-fatal
      if (result.todoistTaskId && result.actualMs) {
        void syncTodoistDuration(result.todoistTaskId, result.actualMs)
      }
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
          overflow_ms = 0, started_at = NULL, paused_at = NULL, updated_at = ?,
          todoist_task_id = NULL
      WHERE id = 1 AND started_at = ?
    `)

    const insertSession = db.prepare(`
      INSERT OR IGNORE INTO sessions
        (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes, todoist_task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        row.todoist_task_id,
      )

      return {
        completed: true,
        alreadyDone: false,
        row: selectTimer.get() as TimerRow,
        todoistTaskId: row.todoist_task_id,
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
      await sendPushToAll(
        'sesh \u2014 session complete',
        result.session.intention || `${result.session.type} session finished`
      )
    }

    // Todoist sync outside transaction, non-fatal
    if (result.todoistTaskId && result.session) {
      void syncTodoistDuration(result.todoistTaskId, result.session.actualMs)
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
        started_at = ?, paused_at = ?, updated_at = ?, todoist_task_id = ?
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
      body.todoistTaskId ?? null,
    )
    const row = db.prepare('SELECT * FROM timer_state WHERE id = 1').get() as TimerRow
    return NextResponse.json(rowToJson(row))
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
