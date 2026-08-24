import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayClock, dayStartUtcSeconds, dueKind, dueLabel, formatDayLabel, nextDayKey, readTimeZone } from '../task-dates'

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

describe('whose day it is', () => {
  afterEach(() => vi.useRealTimers())

  /**
   * The container runs in UTC; the person reading the list does not. At this
   * instant it is already the 24th in Tokyo and still the 23rd in Los Angeles,
   * so the same task has to bucket differently for each of them.
   */
  it('resolves today in the viewer timezone, not the server one', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T22:00:00Z'))

    expect(dayClock('Asia/Tokyo')).toEqual({ today: '2026-08-24', tomorrow: '2026-08-25' })
    expect(dayClock('America/Los_Angeles')).toEqual({ today: '2026-08-23', tomorrow: '2026-08-24' })

    const task = '2026-08-24'
    expect(dueKind(task, dayClock('Asia/Tokyo'))).toBe('today')
    expect(dueKind(task, dayClock('America/Los_Angeles'))).toBe('tomorrow')
  })

  it('falls back to server time for a zone Intl does not know', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T22:00:00Z'))
    expect(dayClock('Mars/Olympus_Mons').today).toBe(new Date().toLocaleDateString('en-CA'))
  })

  it('takes a timezone off the query string, ignoring rubbish', () => {
    expect(readTimeZone(new URLSearchParams('tz=Europe/Berlin'))).toBe('Europe/Berlin')
    expect(readTimeZone(new URLSearchParams('tz=Nowhere/Nothing'))).toBeUndefined()
    expect(readTimeZone(new URLSearchParams(''))).toBeUndefined()
  })

  it('steps days as calendar arithmetic, so DST cannot shift it', () => {
    expect(nextDayKey('2026-03-08')).toBe('2026-03-09')
    expect(nextDayKey('2026-12-31')).toBe('2027-01-01')
    expect(nextDayKey('2028-02-28')).toBe('2028-02-29')
  })

  /** Things writes scheduled dates as exactly this value. */
  it('turns a day key into the UTC second that day begins', () => {
    expect(dayStartUtcSeconds('2026-02-10')).toBe(1770681600)
    expect(new Date(dayStartUtcSeconds('2026-08-24') * 1000).toISOString())
      .toBe('2026-08-24T00:00:00.000Z')
  })

  it('renders a further-out day as something readable', () => {
    expect(formatDayLabel('2026-09-02')).toBe('Wed, Sep 2')
    // A day key is a calendar day, so it must not drift with the server zone.
    expect(formatDayLabel('2026-01-01')).toBe('Thu, Jan 1')
  })
})
