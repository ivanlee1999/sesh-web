import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

interface SessionRow {
  type: string
  category: string
  actual_ms: number
  started_at: number
}

const USER_TZ = 'America/Los_Angeles'

// Get the start of day (midnight) in user timezone as a UTC timestamp
function startOfDayInTZ(date: Date): number {
  // Get the date string in user's timezone (YYYY-MM-DD)
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: USER_TZ })
  // Parse year/month/day
  const [y, m, d] = dateStr.split('-').map(Number)
  // Get the UTC offset for that date in the user's timezone
  // by comparing UTC midnight vs local midnight
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)) // noon UTC to avoid DST edge
  const utcStr = probe.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = probe.toLocaleString('en-US', { timeZone: USER_TZ })
  const utcTime = new Date(utcStr).getTime()
  const tzTime = new Date(tzStr).getTime()
  const offsetMs = utcTime - tzTime
  // Midnight local = midnight UTC + offset
  return Date.UTC(y, m - 1, d) + offsetMs
}

export async function GET() {
  try {
    const db = getDb()
    const rows = db.prepare(
      'SELECT type, category, actual_ms, started_at FROM sessions ORDER BY started_at DESC'
    ).all() as SessionRow[]

    const now = new Date()
    const todayTs = startOfDayInTZ(now)

    const focusSessions = rows.filter(s => s.type === 'focus')
    const todaySessions = focusSessions.filter(s => s.started_at >= todayTs)

    const todayMs = todaySessions.reduce((a, s) => a + s.actual_ms, 0)
    const todayCount = todaySessions.length

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const start = startOfDayInTZ(d)
      const end = start + 86400000
      const ms = focusSessions
        .filter(s => s.started_at >= start && s.started_at < end)
        .reduce((a, s) => a + s.actual_ms, 0)
      return { label: d.toLocaleDateString('en', { weekday: 'short', timeZone: USER_TZ }), ms }
    })

    let streak = 0
    const d = new Date()
    while (true) {
      const start = startOfDayInTZ(d)
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
