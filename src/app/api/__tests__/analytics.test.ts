import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for analytics logic — timezone-aware day boundaries, streak calculation,
 * and 7-day aggregation. Replicates the core logic from analytics/route.ts.
 */

const USER_TZ = 'America/Los_Angeles'

// Replicate the exact startOfDayInTZ function from the route
function startOfDayInTZ(date: Date): number {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: USER_TZ })
  const [y, m, d] = dateStr.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const utcStr = probe.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = probe.toLocaleString('en-US', { timeZone: USER_TZ })
  const utcTime = new Date(utcStr).getTime()
  const tzTime = new Date(tzStr).getTime()
  const offsetMs = utcTime - tzTime
  return Date.UTC(y, m - 1, d) + offsetMs
}

// ── startOfDayInTZ ──────────────────────────────────────────────────────

describe('startOfDayInTZ', () => {
  it('returns midnight PST for a winter date', () => {
    // Jan 15, 2024 — PST is UTC-8
    const date = new Date('2024-01-15T20:00:00Z') // still Jan 15 in PST
    const start = startOfDayInTZ(date)
    // Midnight PST = 08:00 UTC
    expect(start).toBe(Date.UTC(2024, 0, 15, 8, 0, 0))
  })

  it('returns midnight PDT for a summer date', () => {
    // Jul 15, 2024 — PDT is UTC-7
    const date = new Date('2024-07-15T20:00:00Z') // still Jul 15 in PDT
    const start = startOfDayInTZ(date)
    // Midnight PDT = 07:00 UTC
    expect(start).toBe(Date.UTC(2024, 6, 15, 7, 0, 0))
  })

  it('handles date that is next day in UTC but same day in PST', () => {
    // 2am UTC on Jan 16 = 6pm PST on Jan 15
    const date = new Date('2024-01-16T02:00:00Z')
    const start = startOfDayInTZ(date)
    // Should be midnight Jan 15 PST = 08:00 UTC Jan 15
    expect(start).toBe(Date.UTC(2024, 0, 15, 8, 0, 0))
  })

  it('handles date right at midnight PST', () => {
    // Midnight PST = 08:00 UTC
    const date = new Date('2024-01-15T08:00:00Z')
    const start = startOfDayInTZ(date)
    expect(start).toBe(Date.UTC(2024, 0, 15, 8, 0, 0))
  })

  it('returns a value earlier than the input date (always midnight ≤ any time that day)', () => {
    // For any time during a day, startOfDayInTZ should return a value <= that time
    const date = new Date('2024-06-15T20:00:00Z') // clearly daytime in PST
    const start = startOfDayInTZ(date)
    expect(start).toBeLessThanOrEqual(date.getTime())
    // And the gap should be less than 24 hours
    expect(date.getTime() - start).toBeLessThan(86400000)
  })
})

// ── Streak calculation ──────────────────────────────────────────────────

describe('streak calculation', () => {
  // Replicate streak logic
  function calculateStreak(
    focusSessions: Array<{ started_at: number }>,
    referenceDate: Date
  ): number {
    let streak = 0
    const d = new Date(referenceDate)
    while (true) {
      const start = startOfDayInTZ(d)
      const has = focusSessions.some(
        s => s.started_at >= start && s.started_at < start + 86400000
      )
      if (!has) break
      streak++
      d.setDate(d.getDate() - 1)
    }
    return streak
  }

  it('returns 0 when there are no sessions', () => {
    expect(calculateStreak([], new Date('2024-01-15T20:00:00Z'))).toBe(0)
  })

  it('returns 1 for a session today only', () => {
    // Jan 15 PST, session at 3pm PST (11pm UTC)
    const sessions = [{ started_at: Date.UTC(2024, 0, 15, 23, 0, 0) }]
    expect(calculateStreak(sessions, new Date('2024-01-15T23:30:00Z'))).toBe(1)
  })

  it('returns 3 for three consecutive days', () => {
    const sessions = [
      { started_at: Date.UTC(2024, 0, 15, 20, 0, 0) }, // Jan 15 PST
      { started_at: Date.UTC(2024, 0, 14, 20, 0, 0) }, // Jan 14 PST
      { started_at: Date.UTC(2024, 0, 13, 20, 0, 0) }, // Jan 13 PST
    ]
    expect(calculateStreak(sessions, new Date('2024-01-15T23:00:00Z'))).toBe(3)
  })

  it('breaks streak on gap day', () => {
    const sessions = [
      { started_at: Date.UTC(2024, 0, 15, 20, 0, 0) }, // Jan 15 PST
      // Jan 14 missing
      { started_at: Date.UTC(2024, 0, 13, 20, 0, 0) }, // Jan 13 PST
    ]
    expect(calculateStreak(sessions, new Date('2024-01-15T23:00:00Z'))).toBe(1)
  })

  it('returns 0 if no session today (even if yesterday had one)', () => {
    const sessions = [
      { started_at: Date.UTC(2024, 0, 14, 20, 0, 0) }, // Jan 14 PST only
    ]
    expect(calculateStreak(sessions, new Date('2024-01-15T23:00:00Z'))).toBe(0)
  })
})

// ── 7-day aggregation ───────────────────────────────────────────────────

describe('7-day aggregation', () => {
  function aggregate7Days(
    focusSessions: Array<{ actual_ms: number; started_at: number }>,
    referenceDate: Date
  ) {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(referenceDate)
      d.setDate(d.getDate() - (6 - i))
      const start = startOfDayInTZ(d)
      const end = start + 86400000
      const ms = focusSessions
        .filter(s => s.started_at >= start && s.started_at < end)
        .reduce((a, s) => a + s.actual_ms, 0)
      return { ms }
    })
  }

  it('returns 7 entries', () => {
    const days = aggregate7Days([], new Date('2024-01-15T20:00:00Z'))
    expect(days).toHaveLength(7)
  })

  it('aggregates session durations per day', () => {
    const sessions = [
      // Two sessions on Jan 15 PST
      { started_at: Date.UTC(2024, 0, 15, 18, 0, 0), actual_ms: 1500000 },
      { started_at: Date.UTC(2024, 0, 15, 20, 0, 0), actual_ms: 500000 },
      // One session on Jan 14 PST
      { started_at: Date.UTC(2024, 0, 14, 20, 0, 0), actual_ms: 1800000 },
    ]
    const days = aggregate7Days(sessions, new Date('2024-01-15T23:00:00Z'))
    // Last entry (index 6) = today Jan 15 PST
    expect(days[6].ms).toBe(2000000) // 1500000 + 500000
    // Second to last (index 5) = Jan 14 PST
    expect(days[5].ms).toBe(1800000)
    // Earlier days = 0
    expect(days[0].ms).toBe(0)
  })

  it('returns all zeros when no sessions exist', () => {
    const days = aggregate7Days([], new Date('2024-01-15T20:00:00Z'))
    expect(days.every(d => d.ms === 0)).toBe(true)
  })

  it('excludes sessions outside the 7-day window', () => {
    const sessions = [
      // 8 days ago — should not be included
      { started_at: Date.UTC(2024, 0, 7, 20, 0, 0), actual_ms: 999999 },
    ]
    const days = aggregate7Days(sessions, new Date('2024-01-15T23:00:00Z'))
    expect(days.every(d => d.ms === 0)).toBe(true)
  })
})
