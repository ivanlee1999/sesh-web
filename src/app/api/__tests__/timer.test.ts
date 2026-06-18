import { describe, it, expect } from 'vitest'
import {
  buildOverflowNotification,
  nextOverflowNotificationThresholdMinutes,
  shouldTimerNotificationSchedulerRun,
  type TimerRow,
} from '@/lib/timer-notification-logic'

/**
 * Unit tests for timer API logic — specifically the coercion and conversion
 * functions that prevent NaN bugs. We test the logic directly rather than
 * the HTTP handlers (which need a full Next.js + SQLite environment).
 */

// ── toEpochMs — replicated from timer/route.ts for unit testing ─────────
// (The function is not exported, so we replicate the exact logic here)

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

describe('toEpochMs (timer coercion logic)', () => {
  it('returns null for null', () => {
    expect(toEpochMs(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(toEpochMs(undefined)).toBeNull()
  })

  it('passes through finite numbers', () => {
    expect(toEpochMs(1700000000000)).toBe(1700000000000)
    expect(toEpochMs(0)).toBe(0)
    expect(toEpochMs(-1000)).toBe(-1000)
  })

  it('returns null for NaN', () => {
    expect(toEpochMs(NaN)).toBeNull()
  })

  it('returns null for Infinity', () => {
    expect(toEpochMs(Infinity)).toBeNull()
    expect(toEpochMs(-Infinity)).toBeNull()
  })

  it('converts numeric strings to numbers', () => {
    expect(toEpochMs('1700000000000')).toBe(1700000000000)
    expect(toEpochMs('0')).toBe(0)
  })

  it('converts ISO date strings to epoch ms', () => {
    const iso = '2024-01-15T10:30:00.000Z'
    expect(toEpochMs(iso)).toBe(Date.parse(iso))
  })

  it('returns null for unparseable strings', () => {
    expect(toEpochMs('hello')).toBeNull()
    // Note: Number('') === 0 which is finite, so '' returns 0
    expect(toEpochMs('')).toBe(0)
  })

  it('returns null for objects and arrays', () => {
    expect(toEpochMs({})).toBeNull()
    expect(toEpochMs([])).toBeNull()
    expect(toEpochMs(true)).toBeNull()
  })
})

// ── PUT coercion logic ──────────────────────────────────────────────────

describe('PUT handler numeric coercion logic', () => {
  // Replicate the exact coercion from the PUT handler
  function coerceTimerBody(body: Record<string, unknown>) {
    body.startedAt = body.startedAt != null ? toEpochMs(body.startedAt) : null
    body.pausedAt = body.pausedAt != null ? toEpochMs(body.pausedAt) : null
    body.targetMs = Number(body.targetMs) || 0
    body.remainingMs = Number(body.remainingMs) || 0
    body.overflowMs = Number(body.overflowMs) || 0
    return body
  }

  it('coerces string numbers to actual numbers', () => {
    const body = coerceTimerBody({
      targetMs: '1500000',
      remainingMs: '900000',
      overflowMs: '0',
      startedAt: '1700000000000',
      pausedAt: null,
    })
    expect(body.targetMs).toBe(1500000)
    expect(body.remainingMs).toBe(900000)
    expect(body.overflowMs).toBe(0)
    expect(body.startedAt).toBe(1700000000000)
  })

  it('handles ISO string timestamps', () => {
    const iso = '2024-06-01T12:00:00.000Z'
    const body = coerceTimerBody({
      targetMs: 1500000,
      remainingMs: 0,
      overflowMs: 0,
      startedAt: iso,
      pausedAt: null,
    })
    expect(body.startedAt).toBe(Date.parse(iso))
  })

  it('defaults NaN/undefined fields to 0', () => {
    const body = coerceTimerBody({
      targetMs: undefined,
      remainingMs: 'not-a-number',
      overflowMs: NaN,
      startedAt: null,
      pausedAt: null,
    })
    expect(body.targetMs).toBe(0)
    expect(body.remainingMs).toBe(0)
    expect(body.overflowMs).toBe(0)
  })

  it('preserves null timestamps when value is null', () => {
    const body = coerceTimerBody({
      targetMs: 1500000,
      remainingMs: 0,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
    })
    expect(body.startedAt).toBeNull()
    expect(body.pausedAt).toBeNull()
  })
})

// ── Notification threshold calculation ──────────────────────────────────

describe('overflow notification threshold calculation', () => {
  it('count=0 triggers at 0 minutes (immediately on overflow)', () => {
    expect(nextOverflowNotificationThresholdMinutes(0)).toBe(0)
  })

  it('count=1 triggers at 5 minutes', () => {
    expect(nextOverflowNotificationThresholdMinutes(1)).toBe(5)
  })

  it('count=2 triggers at 10 minutes', () => {
    expect(nextOverflowNotificationThresholdMinutes(2)).toBe(10)
  })

  it('count=3 triggers at 15 minutes', () => {
    expect(nextOverflowNotificationThresholdMinutes(3)).toBe(15)
  })

  it('count=4 triggers at 20 minutes', () => {
    expect(nextOverflowNotificationThresholdMinutes(4)).toBe(20)
  })

  it('uses a fixed 5-minute gap between reminders', () => {
    const thresholds = [0, 1, 2, 3, 4, 5].map(nextOverflowNotificationThresholdMinutes)
    expect(thresholds).toEqual([0, 5, 10, 15, 20, 25])
  })
})

// ── Server-side scheduler notification logic ───────────────────────────

describe('server-side timer notification scheduler logic', () => {
  const baseRow: TimerRow = {
    id: 1,
    phase: 'running',
    session_type: 'focus',
    intention: 'Deep work',
    category: 'development',
    target_ms: 25 * 60 * 1000,
    remaining_ms: 1000,
    overflow_ms: 0,
    started_at: 1700000000000,
    paused_at: null,
    updated_at: 1700000000000,
    todoist_task_id: null,
    notification_count: 0,
  }

  it('keeps the server scheduler running for an active timer even without browser clients', () => {
    expect(shouldTimerNotificationSchedulerRun(baseRow)).toBe(true)
  })

  it('does not keep polling when the timer is idle or paused', () => {
    expect(shouldTimerNotificationSchedulerRun({ ...baseRow, phase: 'idle' })).toBe(false)
    expect(shouldTimerNotificationSchedulerRun({ ...baseRow, phase: 'paused' })).toBe(false)
    expect(shouldTimerNotificationSchedulerRun({ ...baseRow, started_at: null })).toBe(false)
  })

  it('builds the first target-reached notification when effective remaining time crosses zero', () => {
    const notification = buildOverflowNotification(baseRow, baseRow.updated_at + 1000)
    expect(notification).toEqual({
      intention: 'Deep work',
      sessionType: 'focus',
      targetMs: 25 * 60 * 1000,
      overflowMs: 0,
      isFirst: true,
      overflowMins: 0,
    })
  })

  it('waits for the next escalating overflow threshold after the first notification', () => {
    const notifiedOnce = { ...baseRow, remaining_ms: 0, notification_count: 1 }
    expect(buildOverflowNotification(notifiedOnce, notifiedOnce.updated_at + 4 * 60 * 1000)).toBeNull()
    expect(buildOverflowNotification(notifiedOnce, notifiedOnce.updated_at + 5 * 60 * 1000)?.overflowMins).toBe(5)
  })
})

// ── Reset notification logic ────────────────────────────────────────────

describe('resetNotifications logic', () => {
  function shouldResetNotifications(body: { phase: string; overflowMs: number; remainingMs: number }): boolean {
    return (body.phase === 'running' && body.overflowMs === 0 && body.remainingMs > 0)
      || body.phase === 'idle'
  }

  it('resets when starting a new session (running, no overflow, remaining > 0)', () => {
    expect(shouldResetNotifications({ phase: 'running', overflowMs: 0, remainingMs: 1500000 })).toBe(true)
  })

  it('resets when going idle', () => {
    expect(shouldResetNotifications({ phase: 'idle', overflowMs: 0, remainingMs: 0 })).toBe(true)
  })

  it('does not reset during overflow (running but overflowMs > 0)', () => {
    expect(shouldResetNotifications({ phase: 'running', overflowMs: 5000, remainingMs: 0 })).toBe(false)
  })

  it('does not reset when paused', () => {
    expect(shouldResetNotifications({ phase: 'paused', overflowMs: 0, remainingMs: 500000 })).toBe(false)
  })
})
