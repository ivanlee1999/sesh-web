export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { readTimeZone } from '@/lib/task-dates'

interface SessionRow {
  type: string
  category: string
  actual_ms: number
  started_at: number
}

/**
 * Where the day boundaries fall.
 *
 * This was a constant, which quietly meant that "today" and the streak were
 * Pacific for everyone — correct for exactly one person in one place. The
 * viewer now says, the way the task routes already do; the old constant
 * remains the answer when nobody says, so existing callers are unchanged.
 */
const DEFAULT_TZ = 'America/Los_Angeles'

/**
 * Get the start of day (midnight) in user timezone as a UTC timestamp.
 * Uses Intl to find the true offset for that specific date, avoiding
 * DST-related errors when probing at noon.
 */
function startOfDayInTZ(date: Date, USER_TZ: string): number {
  // Get the date string in user's timezone (YYYY-MM-DD)
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: USER_TZ })
  return midnightTsForDateStr(dateStr, USER_TZ)
}

/**
 * Convert a YYYY-MM-DD string to the UTC timestamp of midnight in USER_TZ.
 * Uses a noon probe for an initial offset estimate, then corrects for DST
 * transitions where the offset at midnight differs from the offset at noon.
 */
function midnightTsForDateStr(dateStr: string, USER_TZ: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  // Get approximate offset using noon probe
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const utcStr = probe.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = probe.toLocaleString('en-US', { timeZone: USER_TZ })
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime()
  const estimate = Date.UTC(y, m - 1, d) + offsetMs

  // Verify: the noon offset might differ from the midnight offset on DST days.
  // Check that `estimate` is actually midnight of the target date.
  const checkDate = new Date(estimate).toLocaleDateString('en-CA', { timeZone: USER_TZ })
  if (checkDate === dateStr) {
    // Confirm we're at the start of the day, not 1 hour into it
    const beforeDate = new Date(estimate - 1).toLocaleDateString('en-CA', { timeZone: USER_TZ })
    if (beforeDate !== dateStr) return estimate
    // Off by +1 hour (e.g., fall-back day: noon offset is larger than midnight offset)
    return estimate - 3600000
  }
  // Off by -1 hour (e.g., spring-forward day: noon offset is smaller than midnight offset)
  if (checkDate < dateStr) return estimate + 3600000
  return estimate - 3600000
}

/**
 * Get the UTC timestamp of the *next* day's midnight in USER_TZ.
 * This avoids the `+ 86400000` assumption which breaks on DST boundaries.
 */
function nextDayMidnightTs(dateStr: string, USER_TZ: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0))
  const nextDateStr = next.toLocaleDateString('en-CA', { timeZone: USER_TZ })
  return midnightTsForDateStr(nextDateStr, USER_TZ)
}

export async function GET(request: Request) {
  try {
    const db = getDb()
    const USER_TZ = readTimeZone(new URL(request.url).searchParams) || DEFAULT_TZ
    const rows = db.prepare(
      'SELECT type, category, actual_ms, started_at FROM sessions WHERE deleted_at IS NULL ORDER BY started_at DESC'
    ).all() as SessionRow[]

    const now = new Date()
    const todayTs = startOfDayInTZ(now, USER_TZ)

    const focusSessions = rows.filter(s => s.type === 'focus')
    const todaySessions = focusSessions.filter(s => s.started_at >= todayTs)

    const todayMs = todaySessions.reduce((a, s) => a + s.actual_ms, 0)
    const todayCount = todaySessions.length

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const dateStr = d.toLocaleDateString('en-CA', { timeZone: USER_TZ })
      const start = midnightTsForDateStr(dateStr, USER_TZ)
      const end = nextDayMidnightTs(dateStr, USER_TZ)
      const ms = focusSessions
        .filter(s => s.started_at >= start && s.started_at < end)
        .reduce((a, s) => a + s.actual_ms, 0)
      return { label: d.toLocaleDateString('en', { weekday: 'short', timeZone: USER_TZ }), ms }
    })

    let streak = 0
    const d = new Date()
    while (true) {
      const dateStr = d.toLocaleDateString('en-CA', { timeZone: USER_TZ })
      const start = midnightTsForDateStr(dateStr, USER_TZ)
      const end = nextDayMidnightTs(dateStr, USER_TZ)
      const has = focusSessions.some(s => s.started_at >= start && s.started_at < end)
      if (!has) break
      streak++
      d.setDate(d.getDate() - 1)
    }

    return NextResponse.json({ todayMs, todayCount, streak, days })
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
