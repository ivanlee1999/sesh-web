/**
 * Shared due-date bucketing for external task providers, so Todoist and
 * Things group identically in the UI.
 */

export type DueKind = 'today' | 'tomorrow' | 'upcoming'

/** Local YYYY-MM-DD, matching the date strings both providers hand back. */
export function todayKey(): string {
  return new Date().toLocaleDateString('en-CA')
}

export function tomorrowKey(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}

/** Overdue counts as today — it is what you should be working on now. */
export function dueKind(date: string | undefined | null): DueKind | null {
  if (!date) return null
  const day = date.slice(0, 10)
  if (day <= todayKey()) return 'today'
  if (day === tomorrowKey()) return 'tomorrow'
  return 'upcoming'
}

export function dueLabel(date: string | undefined | null, fallback?: string | null): string | null {
  const kind = dueKind(date)
  if (kind === 'today') return 'Today'
  if (kind === 'tomorrow') return 'Tomorrow'
  return fallback ?? date ?? null
}
