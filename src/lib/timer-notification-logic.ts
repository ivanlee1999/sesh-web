export interface TimerRow {
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
  notification_count: number
}

export interface OverflowNotification {
  intention: string
  sessionType: string
  targetMs: number
  overflowMs: number
  isFirst: boolean
  overflowMins: number
}

/**
 * The timer keeps running past target and reminds every 5 minutes:
 *   count=0 → at target time (0 min overflow)
 *   count=1 → +5 min overflow
 *   count=2 → +10 min overflow
 *   count=3 → +15 min overflow
 */
export function nextOverflowNotificationThresholdMinutes(count: number): number {
  return count * 5
}

export function buildOverflowNotification(row: TimerRow, now = Date.now()): OverflowNotification | null {
  if (!row || row.phase !== 'running' || !row.started_at || row.target_ms <= 0) {
    return null
  }

  // Use remainingMs at updatedAt to compute effective remaining time.
  // This correctly handles pause/resume (startedAt doesn't account for paused time).
  const elapsedSinceUpdate = now - row.updated_at
  const effectiveRemaining = row.remaining_ms - elapsedSinceUpdate
  if (effectiveRemaining > 0) return null

  const overflowMs = Math.abs(effectiveRemaining)
  const overflowMinutes = overflowMs / 60_000
  const count = row.notification_count
  const nextThresholdMinutes = nextOverflowNotificationThresholdMinutes(count)
  if (overflowMinutes < nextThresholdMinutes) return null

  const isFirst = count === 0
  const overflowMins = Math.round(overflowMinutes)
  return {
    intention: row.intention,
    sessionType: row.session_type,
    targetMs: row.target_ms,
    overflowMs: Math.round(overflowMs),
    isFirst,
    overflowMins,
  }
}

export function shouldTimerNotificationSchedulerRun(row: Pick<TimerRow, 'phase' | 'started_at' | 'target_ms'> | null | undefined): boolean {
  return !!row && row.phase === 'running' && !!row.started_at && row.target_ms > 0
}

export function rowToTimerJson(row: TimerRow) {
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
