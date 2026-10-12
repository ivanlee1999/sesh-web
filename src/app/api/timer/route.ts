import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { runCompletionSideEffects } from '@/lib/session-complete'
import { applyOps } from '@/lib/sync'
import { InvalidTimerState, resolveTimerCategory, timerGuardMatches, toEpochMs, validateGuardedTimer, validateTimerPrecondition, writeTimerState } from '@/lib/timer-state'
import {
  checkAndSendOverflowNotifications,
  ensureTimerNotificationScheduler,
  rowToTimerJson,
  shouldTimerNotificationSchedulerRun,
  stopTimerNotificationScheduler,
  type TimerRow,
} from '@/lib/timer-notifications'
export const dynamic = 'force-dynamic'


export async function GET() {
  try {
    const result = await checkAndSendOverflowNotifications()
    if (shouldTimerNotificationSchedulerRun(result.row)) {
      ensureTimerNotificationScheduler()
    }
    return NextResponse.json({ ...rowToTimerJson(result.row), timerProtocolVersion: 2 }, { headers: { 'Cache-Control': 'no-store' } })
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
    validateTimerPrecondition(body)
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
    const startedAt: number | null = toEpochMs(body.startedAt)

    if (!startedAt) {
      return NextResponse.json({ error: 'startedAt is required' }, { status: 400 })
    }

    const selectTimer = db.prepare('SELECT * FROM timer_state WHERE id = 1')

    const resetTimer = db.prepare(`
      UPDATE timer_state
      SET phase = 'idle', intention = '', remaining_ms = target_ms,
          overflow_ms = 0, started_at = NULL, paused_at = NULL, updated_at = MAX(?, updated_at + 1),
          todoist_task_id = NULL, notification_count = 0
      WHERE id = 1 AND started_at = ?
    `)

    const insertSession = db.prepare(`
      INSERT OR IGNORE INTO sessions
        (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes, rating, todoist_task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const result = db.transaction(() => {
      const row = selectTimer.get() as TimerRow | undefined
      if (!timerGuardMatches(db, body, deviceId)) {
        return { completed: false, timerConflict: true, row: row ?? null }
      }
      if (!row || !row.started_at || row.started_at !== startedAt) {
        // Timer already completed by another caller (auto-complete or another client)
        return { completed: false, alreadyDone: true, row: row ?? null }
      }

      const endedAt = row.phase === 'paused' && row.paused_at ? row.paused_at : Date.now()
      const category = resolveTimerCategory(db, body.category ?? row.category)
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
        category,
        row.session_type,
        row.target_ms,
        actualMs,
        overflowMs,
        row.started_at,
        endedAt,
        body.notes ?? '',
        Math.max(0, Math.min(5, Number(body.rating) || 0)),
        body.todoistTaskId === undefined ? row.todoist_task_id : body.todoistTaskId,
      )

      return {
        completed: true,
        alreadyDone: false,
        row: selectTimer.get() as TimerRow,
        todoistTaskId: body.todoistTaskId === undefined ? row.todoist_task_id : body.todoistTaskId,
        session: {
          id: sessionId,
          intention: body.intention ?? row.intention,
          category,
          type: row.session_type,
          targetMs: row.target_ms,
          actualMs,
          overflowMs,
          startedAt: row.started_at,
          endedAt,
          notes: body.notes ?? '',
          rating: Math.max(0, Math.min(5, Number(body.rating) || 0)),
        },
      }
    })()

    if (!result.completed) {
      if ('timerConflict' in result && result.timerConflict) {
        return NextResponse.json({ timerConflict: true, timer: result.row ? rowToTimerJson(result.row) : null }, { status: 409 })
      }
      // Return 200 with completed: false — the session was already saved by another path
      return NextResponse.json({ completed: false })
    }

    stopTimerNotificationScheduler()

    // Announcements, task write-back and the calendar entry, outside the
    // transaction and none of them fatal \u2014 shared with the sync route so a
    // session finished offline lands exactly the same way.
    const { calendar } = result.session
      ? await runCompletionSideEffects(
        { ...result.session, todoistTaskId: result.todoistTaskId },
        { isNew: true },
      )
      : { calendar: undefined }

    return NextResponse.json({
      completed: true,
      timer: result.row ? rowToTimerJson(result.row) : null,
      session: result.session,
      calendar,
    })
  } catch (error) {
    if (error instanceof InvalidTimerState) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const db = getDb()
    const body = await request.json()
    validateGuardedTimer(body)
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
    // Web retries use the same transactional receipts as native sync clients.
    if (body.opId !== undefined) {
      if (typeof body.opId !== 'string' || !body.opId || body.opId.length > 128 || deviceId.length > 64)
        throw new InvalidTimerState('Invalid timer operation identity')
      const result = applyOps(db, [{ opId: body.opId, kind: 'timer.mirror', payload: body }], deviceId).results[0]
      const row = db.prepare('SELECT * FROM timer_state WHERE id = 1').get() as TimerRow
      if (result.timerConflict) {
        return NextResponse.json({ timerConflict: true, timer: rowToTimerJson(row), result }, { status: result.status === 'rejected' ? 400 : 409 })
      }
      if (result.status === 'rejected') return NextResponse.json({ error: 'Timer write was not committed' }, { status: 503 })
      if (shouldTimerNotificationSchedulerRun(row)) ensureTimerNotificationScheduler()
      else stopTimerNotificationScheduler()
      return NextResponse.json({ ...rowToTimerJson(row), result, timerProtocolVersion: 2 })
    }
    const outcome = db.transaction(() => {
      if (!timerGuardMatches(db, body, deviceId)) {
        return { conflict: true, row: db.prepare('SELECT * FROM timer_state WHERE id = 1').get() as TimerRow }
      }
      return { conflict: false, row: writeTimerState(db, body, deviceId) }
    })()
    if (outcome.conflict) {
      return NextResponse.json({ timerConflict: true, timer: rowToTimerJson(outcome.row) }, { status: 409 })
    }
    const row = outcome.row
    if (shouldTimerNotificationSchedulerRun(row)) {
      ensureTimerNotificationScheduler()
    } else {
      stopTimerNotificationScheduler()
    }
    return NextResponse.json(rowToTimerJson(row))
  } catch (error) {
    if (error instanceof InvalidTimerState) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
