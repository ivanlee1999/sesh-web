import { describe, expect, it } from 'vitest'
import {
  buildOverflowNotification,
  nextOverflowNotificationThresholdMinutes,
  type TimerRow,
} from '@/lib/timer-notification-logic'

function makeRow(overrides: Partial<TimerRow> = {}): TimerRow {
  return {
    id: 1,
    phase: 'running',
    session_type: 'focus',
    intention: 'Write draft',
    category: 'work',
    target_ms: 25 * 60 * 1000,
    remaining_ms: 25 * 60 * 1000,
    overflow_ms: 0,
    started_at: 1_700_000_000_000,
    paused_at: null,
    updated_at: 1_700_000_000_000,
    todoist_task_id: null,
    notification_count: 0,
    ...overrides,
  }
}

describe('timer notification logic', () => {
  it('uses a fixed 5-minute cadence for overtime reminders', () => {
    expect(nextOverflowNotificationThresholdMinutes(0)).toBe(0)
    expect(nextOverflowNotificationThresholdMinutes(1)).toBe(5)
    expect(nextOverflowNotificationThresholdMinutes(2)).toBe(10)
    expect(nextOverflowNotificationThresholdMinutes(3)).toBe(15)
  })

  it('emits a reminder after each additional 5 minutes of overtime', () => {
    const base = makeRow({ notification_count: 2 })

    expect(
      buildOverflowNotification(base, base.updated_at + base.remaining_ms + 9 * 60_000)
    ).toBeNull()

    expect(
      buildOverflowNotification(base, base.updated_at + base.remaining_ms + 10 * 60_000)
    ).toMatchObject({
      isFirst: false,
      overflowMins: 10,
    })
  })
})
