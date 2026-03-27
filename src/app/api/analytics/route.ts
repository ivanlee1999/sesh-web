import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

interface SessionRow {
  type: string
  category: string
  actual_ms: number
  started_at: number
}

function startOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

export async function GET() {
  try {
    const db = getDb()
    const rows = db.prepare(
      'SELECT type, category, actual_ms, started_at FROM sessions ORDER BY started_at DESC'
    ).all() as SessionRow[]

    const now = Date.now()
    const todayTs = startOfDay(new Date())
    const weekAgo = now - 7 * 24 * 3600000

    const focusSessions = rows.filter(s => s.type === 'focus')
    const todaySessions = focusSessions.filter(s => s.started_at >= todayTs)

    const todayMs = todaySessions.reduce((a, s) => a + s.actual_ms, 0)
    const todayCount = todaySessions.length

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const start = startOfDay(d)
      const end = start + 86400000
      const ms = focusSessions
        .filter(s => s.started_at >= start && s.started_at < end && s.started_at >= weekAgo)
        .reduce((a, s) => a + s.actual_ms, 0)
      return { label: d.toLocaleDateString('en', { weekday: 'short' }), ms }
    })

    let streak = 0
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    while (true) {
      const start = d.getTime()
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
