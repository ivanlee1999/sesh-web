import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dueKind, dueLabel } from '../task-dates'

describe('due date bucketing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 23, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('buckets today, tomorrow and later', () => {
    expect(dueKind('2026-08-23')).toBe('today')
    expect(dueKind('2026-08-24')).toBe('tomorrow')
    expect(dueKind('2026-09-01')).toBe('upcoming')
  })

  it('counts overdue as today — it is what to work on now', () => {
    expect(dueKind('2026-08-01')).toBe('today')
  })

  it('accepts full timestamps, not just dates', () => {
    expect(dueKind('2026-08-24T09:30:00Z')).toBe('tomorrow')
  })

  it('returns null when there is no date', () => {
    expect(dueKind(null)).toBeNull()
    expect(dueKind(undefined)).toBeNull()
  })

  it('labels near dates and falls back for far ones', () => {
    expect(dueLabel('2026-08-23')).toBe('Today')
    expect(dueLabel('2026-08-24')).toBe('Tomorrow')
    expect(dueLabel('2026-09-01', 'Sep 1')).toBe('Sep 1')
    expect(dueLabel('2026-09-01')).toBe('2026-09-01')
  })
})
