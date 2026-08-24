/**
 * Shared due-date bucketing for external task providers, so Todoist and
 * Things group identically in the UI.
 *
 * These are calendar dates, not instants: "today" is a property of the person
 * reading the list, not of the machine serving it. sesh runs in a UTC container
 * while its user almost never does, so every bucket here is decided against a
 * timezone the caller supplies rather than against the server's own clock.
 */

export type DueKind = 'today' | 'tomorrow' | 'upcoming'

/**
 * The two day keys every bucketing decision needs, resolved once per request.
 * Both are local YYYY-MM-DD, matching the date strings the providers hand back.
 */
export interface DayClock {
  today: string
  tomorrow: string
}

/** en-CA is the shortest way to get YYYY-MM-DD out of Intl. */
function formatDayKey(date: Date, timeZone?: string): string {
  if (!timeZone) return date.toLocaleDateString('en-CA')
  try {
    return date.toLocaleDateString('en-CA', { timeZone })
  } catch {
    // The zone arrives from the browser, so it can be anything. A bad one falls
    // back to server time rather than failing the whole request.
    return date.toLocaleDateString('en-CA')
  }
}

/** Calendar arithmetic on the key itself, so DST can't shift the answer. */
export function nextDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

/**
 * The instant a calendar day begins in UTC, in Unix seconds. Things encodes
 * scheduled dates exactly this way, so this is what a stored date compares
 * against.
 */
export function dayStartUtcSeconds(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 1000)
}

export function dayClock(timeZone?: string): DayClock {
  const today = formatDayKey(new Date(), timeZone)
  return { today, tomorrow: nextDayKey(today) }
}

/**
 * The viewer's timezone, if the browser sent one. Anything Intl does not
 * recognise is dropped: a bad value should degrade to server time, not fail.
 */
export function readTimeZone(params: URLSearchParams): string | undefined {
  const tz = params.get('tz')?.trim()
  if (!tz) return undefined
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return tz
  } catch {
    return undefined
  }
}

/**
 * A day key as something worth reading — "Wed, Sep 2" rather than "2026-09-02".
 * Formatted in UTC because the key is already a calendar day, not an instant;
 * re-interpreting it in a zone would shift it.
 */
export function formatDayLabel(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) return key
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function todayKey(timeZone?: string): string {
  return formatDayKey(new Date(), timeZone)
}

export function tomorrowKey(timeZone?: string): string {
  return nextDayKey(todayKey(timeZone))
}

/** Overdue counts as today — it is what you should be working on now. */
export function dueKind(date: string | undefined | null, clock: DayClock = dayClock()): DueKind | null {
  if (!date) return null
  const day = date.slice(0, 10)
  if (day <= clock.today) return 'today'
  if (day === clock.tomorrow) return 'tomorrow'
  return 'upcoming'
}

export function dueLabel(
  date: string | undefined | null,
  fallback?: string | null,
  clock: DayClock = dayClock(),
): string | null {
  const kind = dueKind(date, clock)
  if (kind === 'today') return 'Today'
  if (kind === 'tomorrow') return 'Tomorrow'
  return fallback ?? date ?? null
}
