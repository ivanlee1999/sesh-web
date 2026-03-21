'use client'
import { useState, useEffect } from 'react'
import { getAllSessions } from '@/lib/db'
import type { Session } from '@/types'
import { CATEGORY_COLORS, CATEGORY_LABELS, type Category } from '@/types'

function msToHM(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function startOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

interface ServerAnalytics {
  todayMs: number
  todayCount: number
  streak: number
  days: { label: string; ms: number }[]
}

export default function Analytics() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [serverStats, setServerStats] = useState<ServerAnalytics | null>(null)

  useEffect(() => {
    const load = async () => {
      // Fetch server analytics
      try {
        const res = await fetch('/api/analytics')
        if (res.ok) {
          setServerStats(await res.json())
        }
      } catch {}

      // Fetch full session list (for category breakdown + timeline)
      try {
        const res = await fetch('/api/sessions')
        if (res.ok) {
          setSessions(await res.json())
          return
        }
      } catch {}
      // Fallback to IndexedDB
      const all = await getAllSessions()
      setSessions(all)
    }
    load()
  }, [])

  // Use server stats if available, otherwise compute locally
  const todayMs = serverStats?.todayMs ?? (() => {
    const today = startOfDay(new Date())
    return sessions.filter(s => s.startedAt >= today && s.type === 'focus').reduce((a, s) => a + s.actualMs, 0)
  })()
  const todayCount = serverStats?.todayCount ?? (() => {
    const today = startOfDay(new Date())
    return sessions.filter(s => s.startedAt >= today && s.type === 'focus').length
  })()
  const streak = serverStats?.streak ?? (() => {
    let s = 0
    const d = new Date()
    while (true) {
      const start = startOfDay(d)
      const has = sessions.some(x => x.startedAt >= start && x.startedAt < start + 86400000 && x.type === 'focus')
      if (!has) break
      s++
      d.setDate(d.getDate() - 1)
    }
    return s
  })()
  const days = serverStats?.days ?? Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const start = startOfDay(d)
    const end = start + 86400000
    const weekAgo = Date.now() - 7 * 24 * 3600000
    const ms = sessions
      .filter(s => s.type === 'focus' && s.startedAt >= start && s.startedAt < end && s.startedAt >= weekAgo)
      .reduce((a, s) => a + s.actualMs, 0)
    return { label: d.toLocaleDateString('en', { weekday: 'short' }), ms }
  })

  const maxMs = Math.max(...days.map(d => d.ms), 1)

  // Category breakdown (all time, focus only)
  const focusSessions = sessions.filter(s => s.type === 'focus')
  const totalFocusMs = focusSessions.reduce((a, s) => a + s.actualMs, 0)
  const catBreakdown = (Object.keys(CATEGORY_LABELS) as Category[]).map(cat => {
    const ms = focusSessions.filter(s => s.category === cat).reduce((a, s) => a + s.actualMs, 0)
    return { cat, ms, pct: totalFocusMs ? Math.round((ms / totalFocusMs) * 100) : 0 }
  }).filter(x => x.ms > 0).sort((a, b) => b.ms - a.ms)

  return (
    <div className="px-4 pt-16 md:pt-20 pb-4 flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Analytics</h1>

      {/* Today summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 text-center shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="text-2xl font-bold text-green-500">{msToHM(todayMs)}</div>
          <div className="text-xs text-gray-500 mt-1">Today</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 text-center shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="text-2xl font-bold text-blue-500">{todayCount}</div>
          <div className="text-xs text-gray-500 mt-1">Sessions</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 text-center shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="text-2xl font-bold text-amber-500">{streak}</div>
          <div className="text-xs text-gray-500 mt-1">Day streak</div>
        </div>
      </div>

      {/* 7-day bar chart */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">Last 7 Days</h2>
        <div className="flex items-end gap-2 h-24">
          {days.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-t-md bg-green-400 dark:bg-green-500 transition-all"
                style={{ height: `${(d.ms / maxMs) * 88}px`, minHeight: d.ms > 0 ? 4 : 0 }}
                title={msToHM(d.ms)}
              />
              <span className="text-xs text-gray-400">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Category breakdown */}
      {catBreakdown.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Categories</h2>
          <div className="flex flex-col gap-2">
            {catBreakdown.map(({ cat, ms, pct }) => (
              <div key={cat} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{CATEGORY_LABELS[cat]}</span>
                <span className="text-xs text-gray-500">{msToHM(ms)}</span>
                <div className="w-20 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[cat] }} />
                </div>
                <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily timeline */}
      <DailyTimeline sessions={sessions} />
    </div>
  )
}

function DailyTimeline({ sessions }: { sessions: Session[] }) {
  const today = startOfDay(new Date())
  const todaySessions = sessions.filter(s => s.startedAt >= today && s.startedAt < today + 86400000)

  const START_HOUR = 8
  const END_HOUR = 23
  const totalMinutes = (END_HOUR - START_HOUR) * 60

  if (todaySessions.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
      <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Today&apos;s Timeline</h2>
      <div className="relative h-12 bg-gray-50 dark:bg-gray-900 rounded-lg overflow-hidden">
        {todaySessions.map(s => {
          const startMin = (new Date(s.startedAt).getHours() - START_HOUR) * 60 + new Date(s.startedAt).getMinutes()
          const durMin = s.actualMs / 60000
          const left = Math.max(0, (startMin / totalMinutes) * 100)
          const width = Math.min(100 - left, (durMin / totalMinutes) * 100)
          return (
            <div
              key={s.id}
              className="absolute top-2 bottom-2 rounded opacity-80"
              style={{
                left: `${left}%`,
                width: `${Math.max(width, 0.5)}%`,
                backgroundColor: CATEGORY_COLORS[s.category],
              }}
              title={`${s.intention || s.type} — ${Math.round(s.actualMs / 60000)}m`}
            />
          )
        })}
        {/* Hour labels */}
        {[8, 12, 16, 20].map(h => (
          <span
            key={h}
            className="absolute top-0 text-xs text-gray-300 dark:text-gray-600"
            style={{ left: `${((h - START_HOUR) / (END_HOUR - START_HOUR)) * 100}%` }}
          >
            {h}
          </span>
        ))}
      </div>
    </div>
  )
}
