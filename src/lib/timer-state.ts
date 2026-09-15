import type Database from 'better-sqlite3'
import type { TimerRow } from '@/lib/timer-notification-logic'

/** Coerce a value to epoch-ms number, handling ISO strings from legacy/Raycast clients */
export function toEpochMs(value: unknown): number | null {
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

/**
 * The category the timer will actually be stored against.
 *
 * An unknown or deleted one silently becomes the default rather than being
 * rejected: the timer is a single row shared by every device, and refusing the
 * write would strand a client that is merely out of date about the category
 * list. A tombstoned category is treated as gone — it is still in the table so
 * that other devices learn of the deletion, not so that it can be chosen.
 */
export function resolveTimerCategory(db: Database.Database, requested: unknown): string {
  const wanted = typeof requested === 'string' ? requested : ''
  if (wanted) {
    const found = db.prepare('SELECT name FROM categories WHERE name = ? AND deleted_at IS NULL').get(wanted) as
      { name: string } | undefined
    if (found) return found.name
  }
  const fallback = db.prepare('SELECT name FROM categories WHERE is_default = 1 AND deleted_at IS NULL LIMIT 1').get() as
    { name: string } | undefined
    ?? db.prepare('SELECT name FROM categories WHERE deleted_at IS NULL ORDER BY sort_order LIMIT 1').get() as
    { name: string } | undefined
  return fallback?.name ?? ''
}

export interface TimerStateInput {
  phase?: unknown
  sessionType?: unknown
  intention?: unknown
  category?: unknown
  targetMs?: unknown
  remainingMs?: unknown
  overflowMs?: unknown
  startedAt?: unknown
  pausedAt?: unknown
  todoistTaskId?: unknown
}

/**
 * Write the shared timer row.
 *
 * Shared by `PUT /api/timer` and the sync route's `timer.mirror` op, which are
 * the same act from two kinds of client: the timer is one row and the last
 * writer wins, deliberately — two devices running two different timers is not
 * a state this app has ever had, and inventing a merge for it would be
 * inventing a problem.
 */
export function writeTimerState(
  db: Database.Database,
  body: TimerStateInput,
  deviceId = '',
): TimerRow {
  const now = Date.now()
  const startedAt = body.startedAt != null ? toEpochMs(body.startedAt) : null
  const pausedAt = body.pausedAt != null ? toEpochMs(body.pausedAt) : null
  const targetMs = Number(body.targetMs) || 0
  const remainingMs = Number(body.remainingMs) || 0
  const overflowMs = Number(body.overflowMs) || 0
  const phase = typeof body.phase === 'string' ? body.phase : 'idle'

  // Reset the overflow reminder count when a fresh session starts or the timer
  // goes idle, so the next session's reminders start from the beginning.
  const resetNotifications = (phase === 'running' && overflowMs === 0 && remainingMs > 0) || phase === 'idle'

  db.prepare(`
    UPDATE timer_state SET
      phase = ?, session_type = ?, intention = ?, category = ?,
      target_ms = ?, remaining_ms = ?, overflow_ms = ?,
      started_at = ?, paused_at = ?, updated_at = ?, todoist_task_id = ?,
      device_id = ?,
      notification_count = CASE WHEN ? THEN 0 ELSE notification_count END
    WHERE id = 1
  `).run(
    phase,
    typeof body.sessionType === 'string' ? body.sessionType : 'focus',
    typeof body.intention === 'string' ? body.intention : '',
    resolveTimerCategory(db, body.category),
    targetMs,
    remainingMs,
    overflowMs,
    startedAt,
    pausedAt,
    now,
    typeof body.todoistTaskId === 'string' && body.todoistTaskId ? body.todoistTaskId : null,
    deviceId,
    resetNotifications ? 1 : 0,
  )

  return db.prepare('SELECT * FROM timer_state WHERE id = 1').get() as TimerRow
}
