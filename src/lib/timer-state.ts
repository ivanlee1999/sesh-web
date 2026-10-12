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
  expectedUpdatedAt?: unknown
  expectedStartedAt?: unknown
  afterTimerOpId?: unknown
  /** Instant remainingMs was measured, rather than request arrival. */
  recordedAt?: unknown
}

export class InvalidTimerState extends Error {}

export function hasTimerGuard(body: TimerStateInput): boolean {
  return 'expectedUpdatedAt' in body || 'expectedStartedAt' in body || 'afterTimerOpId' in body
}

/** Legacy callers keep their coercion; protocol 2 must send a complete baseline. */
export function validateTimerPrecondition(body: TimerStateInput): void {
  if (!hasTimerGuard(body)) return
  const whole = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value)
  const timestamp = (value: unknown) => value === null || (whole(value) && (value as number) > 0)
  if (body.afterTimerOpId !== undefined) {
    if (typeof body.afterTimerOpId !== 'string' || !body.afterTimerOpId || body.afterTimerOpId.length > 128)
      throw new InvalidTimerState('Invalid preceding timer op')
  } else if (!whole(body.expectedUpdatedAt) || (body.expectedUpdatedAt as number) < 0 || !timestamp(body.expectedStartedAt)) {
    throw new InvalidTimerState('Both expectedUpdatedAt and expectedStartedAt are required')
  }
}

export function validateGuardedTimer(body: TimerStateInput): void {
  if (!hasTimerGuard(body)) return
  validateTimerPrecondition(body)
  const whole = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value)
  const timestamp = (value: unknown) => value === null || (whole(value) && (value as number) > 0)
  if (!['idle', 'running', 'paused'].includes(String(body.phase)) || !['focus', 'break'].includes(String(body.sessionType)))
    throw new InvalidTimerState('Invalid timer phase or type')
  if (!whole(body.targetMs) || (body.targetMs as number) < 0 || (body.targetMs as number) > 24 * 60 * 60 * 1000 ||
      !whole(body.remainingMs) || !timestamp(body.startedAt) || !timestamp(body.pausedAt) ||
      !whole(body.recordedAt) || (body.recordedAt as number) <= 0 || (body.recordedAt as number) > Date.now() + 60_000)
    throw new InvalidTimerState('Invalid timer timing')
  if (body.phase !== 'idle' && (!body.startedAt || (body.targetMs as number) <= 0))
    throw new InvalidTimerState('An active timer needs its original start and duration')
  if (body.phase === 'idle' && body.startedAt !== null)
    throw new InvalidTimerState('An idle timer cannot have a session start')
  if (typeof body.intention !== 'string' || body.intention.length > 10_000 ||
      typeof body.category !== 'string' || body.category.length > 200)
    throw new InvalidTimerState('Invalid timer text')
}

/** Caller must run check and write in the same transaction. */
export function timerGuardMatches(db: Database.Database, body: TimerStateInput, deviceId: string): boolean {
  if (!hasTimerGuard(body)) return true
  const row = db.prepare('SELECT updated_at, started_at FROM timer_state WHERE id = 1').get() as
    { updated_at: number; started_at: number | null }
  let expectedUpdatedAt = body.expectedUpdatedAt
  let expectedStartedAt = body.expectedStartedAt
  if (body.afterTimerOpId !== undefined) {
    const receipt = db.prepare('SELECT result, device_id FROM sync_ops WHERE op_id = ?').get(body.afterTimerOpId) as
      { result: string; device_id: string } | undefined
    if (!receipt || receipt.device_id !== deviceId) return false
    const result = JSON.parse(receipt.result) as {
      status: string; timerConflict?: boolean; timerChainAllowed?: boolean; timerUpdatedAt?: number; timerStartedAt?: number | null
    }
    if (!['applied', 'stale'].includes(result.status) || result.timerConflict || result.timerChainAllowed === false || result.timerUpdatedAt === undefined) return false
    expectedUpdatedAt = result.timerUpdatedAt
    expectedStartedAt = result.timerStartedAt
  }
  // A stale active snapshot must never resurrect a sitting older than the winner.
  if (body.phase !== undefined && body.phase !== 'idle' && row.started_at !== null &&
      typeof body.startedAt === 'number' && body.startedAt < row.started_at) return false
  return row.updated_at === expectedUpdatedAt && row.started_at === expectedStartedAt
}

/**
 * Write the shared timer row.
 *
 * Shared by `PUT /api/timer` and sync's `timer.mirror`. Protocol 2 callers
 * guard it transactionally; legacy callers retain last-writer-wins behavior.
 */
export function writeTimerState(
  db: Database.Database,
  body: TimerStateInput,
  deviceId = '',
): TimerRow {
  const previous = db.prepare('SELECT updated_at FROM timer_state WHERE id = 1').get() as { updated_at: number }
  // A version token as well as a clock: same-millisecond writes must differ.
  const now = Math.max(Date.now(), previous.updated_at + 1)
  const startedAt = body.startedAt != null ? toEpochMs(body.startedAt) : null
  const pausedAt = body.pausedAt != null ? toEpochMs(body.pausedAt) : null
  const targetMs = Number(body.targetMs) || 0
  const phase = typeof body.phase === 'string' ? body.phase : 'idle'
  const delay = hasTimerGuard(body) && phase === 'running'
    ? Math.max(0, now - Number(body.recordedAt)) : 0
  const remainingMs = Math.round((Number(body.remainingMs) || 0) - delay)
  const overflowMs = hasTimerGuard(body) ? Math.max(0, -remainingMs) : Number(body.overflowMs) || 0

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
