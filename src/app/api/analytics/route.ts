import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

interface SessionRow {
  type: string
  category: string
  actual_ms: number
  started_at: number
}

// Get start of day in user's timezone (PST/PDT)
function startOfDayTZ(d: Date, tz: string): number {
  // Format date in target timezone to get the local date string
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d) // returns "YYYY-MM-DD"
  // Parse as midnight in that timezone
  const midnight = new Date(`${parts}T00:00:00`)
  // Get the UTC offset for that midnight in the target timezone
  const utcMidnight = new Date(
    midnight.toLocaleString('en-US', { timeZone: 'UTC' })
  )
  const tzMidnight = new Date(
    midnight.toLocaleString('en-US', { timeZone: tz })
  )
  const offset = utcMidnight.getTime() - tzMidnight.getTime()
  return new Date(`${parts}T00:00:00`).getTime() + offset
}

const USER_TZ = 'America/Los_Angeles'

export async function GET() {
  try {
    const db = getDb()
    const rows = db.prepare(
      'SELECT type, category, actual_ms, started_at FROM sessions ORDER BY started_at DESC'
    ).all() as SessionRow[]

    const now = Date.now()
    const todayTs = startOfDayTZ(new Date(), USER_TZ)
    const weekAgo = now - 7 * 24 * 3600000

    const focusSessions = rows.filter(s => s.type === 'focus')
    const todaySessions = focusSessions.filter(s => s.started_at >= todayTs)

    const todayMs = todaySessions.reduce((a, s) => a + s.actual_ms, 0)
    const todayCount = todaySessions.length

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const start = startOfDayTZ(d, USER_TZ)
      const end = start + 86400000
      const ms = focusSessions
        .filter(s => s.started_at >= start && s.started_at < end && s.started_at >= weekAgo)
        .reduce((a, s) => a + s.actual_ms, 0)
      return { label: d.toLocaleDateString('en', { weekday: 'short', timeZone: USER_TZ }), ms }
    })

    let streak = 0
    const d = new Date()
    while (true) {
      const start = startOfDayTZ(d, USER_TZ)
      const has = focusSessions.some(s => s.started_at >= start && s.started_at < start + 86400000)
      if (!has) break
      streak++
      d.setDate(d.getDate() - 1)
    }

    return NextResponse.json({ todayMs, todayCount, streak, days })
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
