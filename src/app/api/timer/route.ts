import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { sendPushToAll } from '@/lib/push'
import { isTodoistConfigured, addTaskDuration } from '@/lib/todoist'
import { syncSessionToGoogleCalendar, persistCalendarSyncResult } from '@/lib/google-calendar'
import {
  checkAndSendOverflowNotifications,
  ensureTimerNotificationScheduler,
  rowToTimerJson,
  sendDiscordNotification,
  shouldTimerNotificationSchedulerRun,
  stopTimerNotificationScheduler,
  type TimerRow,
} from '@/lib/timer-notifications'
export const dynamic = 'force-dynamic'

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


export async function GET() {
  try {
    const result = await checkAndSendOverflowNotifications()
    if (shouldTimerNotificationSchedulerRun(result.row)) {
      ensureTimerNotificationScheduler()
    }
    return NextResponse.json(rowToTimerJson(result.row))
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
    const startedAt: number | null = toEpochMs(body.startedAt)

    if (!startedAt) {
      return NextResponse.json({ error: 'startedAt is required' }, { status: 400 })
    }

    const selectTimer = db.prepare('SELECT * FROM timer_state WHERE id = 1')

    const resetTimer = db.prepare(`
      UPDATE timer_state
      SET phase = 'idle', intention = '', remaining_ms = target_ms,
          overflow_ms = 0, started_at = NULL, paused_at = NULL, updated_at = ?,
          todoist_task_id = NULL, notification_count = 0
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
        row.category,
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
          category: row.category,
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

    stopTimerNotificationScheduler()

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

    // Google Calendar sync, non-fatal
    let calendar: { synced: boolean; skipped?: string; eventId?: string; error?: string } | undefined
    if (result.session) {
      calendar = await syncSessionToGoogleCalendar({
        ...result.session,
        googleEventId: '',
        isSynced: false,
      })
      if (calendar) persistCalendarSyncResult(result.session.id, calendar)
    }

    return NextResponse.json({
      completed: true,
      timer: result.row ? rowToTimerJson(result.row) : null,
      session: result.session,
      calendar,
    })
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

/** Coerce a value to epoch-ms number, handling ISO strings from legacy/Raycast clients */
function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
    const t = Date.parse(value)
    if (Number.isFinite(t)) return t
  }
  return null
}

export async function PUT(request: Request) {
  try {
    const db = getDb()
    const body = await request.json()
    const now = Date.now()

    // Normalize timestamps — Raycast may send ISO strings or numbers
    body.startedAt = body.startedAt != null ? toEpochMs(body.startedAt) : null
    body.pausedAt = body.pausedAt != null ? toEpochMs(body.pausedAt) : null

    // Coerce all numeric fields — clients may send strings (e.g. from form inputs)
    body.targetMs = Number(body.targetMs) || 0
    body.remainingMs = Number(body.remainingMs) || 0
    body.overflowMs = Number(body.overflowMs) || 0

    // Validate that the category exists in the categories table.
    // If the provided category is missing or invalid, fall back to the
    // default category (is_default=1) or the first available one.
    let resolvedCategory: string = body.category ?? ''
    if (resolvedCategory) {
      const catRow = db.prepare('SELECT name FROM categories WHERE name = ?').get(resolvedCategory) as { name: string } | undefined
      if (!catRow) resolvedCategory = ''
    }
    if (!resolvedCategory) {
      const defaultCat = db.prepare('SELECT name FROM categories WHERE is_default = 1 LIMIT 1').get() as { name: string } | undefined
        ?? db.prepare('SELECT name FROM categories ORDER BY sort_order LIMIT 1').get() as { name: string } | undefined
      resolvedCategory = defaultCat?.name ?? ''
    }

    // Reset notification_count when starting a new session or going idle
    const resetNotifications = (body.phase === 'running' && (body.overflowMs ?? 0) === 0 && (body.remainingMs ?? 0) > 0)
      || body.phase === 'idle'
    db.prepare(`
      UPDATE timer_state SET
        phase = ?, session_type = ?, intention = ?, category = ?,
        target_ms = ?, remaining_ms = ?, overflow_ms = ?,
        started_at = ?, paused_at = ?, updated_at = ?, todoist_task_id = ?,
        notification_count = CASE WHEN ? THEN 0 ELSE notification_count END
      WHERE id = 1
    `).run(
      body.phase ?? 'idle',
      body.sessionType ?? 'focus',
      body.intention ?? '',
      resolvedCategory,
      body.targetMs ?? 0,
      body.remainingMs ?? 0,
      body.overflowMs ?? 0,
      body.startedAt ?? null,
      body.pausedAt ?? null,
      now,
      body.todoistTaskId ?? null,
      resetNotifications ? 1 : 0,
    )
    const row = db.prepare('SELECT * FROM timer_state WHERE id = 1').get() as TimerRow
    if (shouldTimerNotificationSchedulerRun(row)) {
      ensureTimerNotificationScheduler()
    } else {
      stopTimerNotificationScheduler()
    }
    return NextResponse.json(rowToTimerJson(row))
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
