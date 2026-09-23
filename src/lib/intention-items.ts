/**
 * An intention can name several things at once. It is still stored as one
 * string — the same `A · B` form picking several tasks has always written — so
 * the API, the DB, calendar titles and every older client keep reading what
 * they expect. These helpers are the only place that knows the separator.
 */

export const INTENTION_SEPARATOR = ' · '

/** The individual items in a stored intention, trimmed, empties dropped. */
export function splitIntention(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split('·').map(item => item.trim()).filter(Boolean)
}

/** One stored intention from its items. */
export function joinIntention(items: readonly string[]): string {
  return items.map(item => item.trim()).filter(Boolean).join(INTENTION_SEPARATOR)
}

export interface IntentionHistoryEntry {
  intention: string
  startedAt: number
}

export interface RankedItem {
  text: string
  score: number
}

/** A use this many days old counts half as much as one today. */
const HALF_LIFE_DAYS = 14
const DAY_MS = 86_400_000

/**
 * Every item ever typed, best first. Each past use adds weight that decays
 * with age, so something done daily this month beats something done fifty
 * times last year, and both beat a one-off. Items that differ only in case
 * are one item, shown as most recently written.
 */
export function rankIntentionHistory(entries: readonly IntentionHistoryEntry[], now = Date.now()): RankedItem[] {
  const byKey = new Map<string, { text: string; score: number; last: number }>()
  for (const entry of entries) {
    const age = Math.max(0, now - (entry.startedAt || 0))
    const weight = Math.pow(0.5, age / (HALF_LIFE_DAYS * DAY_MS))
    for (const text of splitIntention(entry.intention)) {
      const key = text.toLowerCase()
      const found = byKey.get(key)
      if (!found) {
        byKey.set(key, { text, score: weight, last: entry.startedAt })
      } else {
        found.score += weight
        if (entry.startedAt > found.last) {
          found.last = entry.startedAt
          found.text = text
        }
      }
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.score - a.score || b.last - a.last)
    .map(({ text, score }) => ({ text, score }))
}

/**
 * What to offer for a half-typed item: nothing typed shows the top of the
 * history; otherwise items starting with the query come before items merely
 * containing it, each group in rank order. Items already chosen, and an exact
 * match for what is typed, are left out — offering them adds nothing.
 */
export function suggestIntentionItems(
  ranked: readonly RankedItem[],
  query: string,
  exclude: readonly string[] = [],
  limit = 6,
): string[] {
  const skip = new Set(exclude.map(item => item.toLowerCase()))
  const q = query.trim().toLowerCase()
  const open = ranked.filter(item => !skip.has(item.text.toLowerCase()) && item.text.toLowerCase() !== q)
  if (!q) return open.slice(0, limit).map(item => item.text)
  const starts: string[] = []
  const contains: string[] = []
  for (const item of open) {
    const text = item.text.toLowerCase()
    if (text.startsWith(q)) starts.push(item.text)
    else if (text.includes(q)) contains.push(item.text)
  }
  return [...starts, ...contains].slice(0, limit)
}
