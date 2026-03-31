'use client'
import { useState, useEffect } from 'react'
import { Card } from 'konsta/react'
import type { Session } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { getCategoryMeta } from '@/lib/categories'

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

const PALETTE = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-violet-500',
  'bg-pink-500',
  'bg-teal-500',
]

interface ServerAnalytics {
  todayMs: number
  todayCount: number
  streak: number
  days: { label: string; ms: number }[]
}

export default function Analytics() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [serverStats, setServerStats] = useState<ServerAnalytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { categories } = useCategories()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [analyticsRes, sessionsRes] = await Promise.all([
          fetch('/api/analytics'),
          fetch('/api/sessions'),
        ])

        if (!analyticsRes.ok || !sessionsRes.ok) {
          throw new Error('Failed to load analytics')
        }

        setServerStats(await analyticsRes.json())
        setSessions(await sessionsRes.json())
      } catch {
        setError('Failed to load analytics data. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-83px-env(safe-area-inset-bottom,0px))] flex-col gap-6 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-4 pt-16 [-webkit-overflow-scrolling:touch] md:pt-20">
        <h1 className="text-xl font-semibold text-black dark:text-white">Analytics</h1>
        <div className="py-16 text-center text-gray-400">
          <p className="text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[calc(100dvh-83px-env(safe-area-inset-bottom,0px))] flex-col gap-6 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-4 pt-16 [-webkit-overflow-scrolling:touch] md:pt-20">
        <h1 className="text-xl font-semibold text-black dark:text-white">Analytics</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      </div>
    )
  }

  const todayMs = serverStats?.todayMs ?? 0
  const todayCount = serverStats?.todayCount ?? 0
  const streak = serverStats?.streak ?? 0
  const days = serverStats?.days ?? []

  const maxMs = Math.max(...days.map(d => d.ms), 1)

  // Category breakdown (all time, focus only) — built from actual session data
  const focusSessions = sessions.filter(s => s.type === 'focus')
  const totalFocusMs = focusSessions.reduce((a, s) => a + s.actualMs, 0)
  const groupedByCategory: Record<string, number> = {}
  for (const s of focusSessions) {
    groupedByCategory[s.category] = (groupedByCategory[s.category] ?? 0) + s.actualMs
  }
  const catBreakdown = Object.entries(groupedByCategory)
    .map(([name, ms]) => {
      const meta = getCategoryMeta(name, categories)
      return { name, ms, pct: totalFocusMs ? Math.round((ms / totalFocusMs) * 100) : 0, ...meta }
    })
    .sort((a, b) => b.ms - a.ms)

  return (
    <div className="flex h-[calc(100dvh-83px-env(safe-area-inset-bottom,0px))] flex-col gap-6 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-4 pt-16 [-webkit-overflow-scrolling:touch] md:pt-20">
      <h1 className="text-xl font-semibold text-black dark:text-white">Analytics</h1>

      {/* Today summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="!m-0 !rounded-2xl !bg-white !shadow-sm dark:!bg-gray-800">
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-500">{msToHM(todayMs)}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Today</div>
          </div>
        </Card>
        <Card className="!m-0 !rounded-2xl !bg-white !shadow-sm dark:!bg-gray-800">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-500">{todayCount}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Sessions</div>
          </div>
        </Card>
        <Card className="!m-0 !rounded-2xl !bg-white !shadow-sm dark:!bg-gray-800">
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-500">{streak}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Day streak</div>
          </div>
        </Card>
      </div>

      {/* 7-day bar chart */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-300">Last 7 Days</h2>
        <div className="flex h-24 items-end gap-2">
          {days.map((d, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t-md bg-emerald-400 transition-all dark:bg-emerald-500"
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
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Categories</h2>
          <div className="flex flex-col gap-2">
            {catBreakdown.map(({ name, ms, pct, label }, index) => {
              return (
                <div key={name} className="flex items-center gap-2">
                  <div
                    className={`h-2 w-2 rounded-full ${PALETTE[index % PALETTE.length]}`}
                  />
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{label}</span>
                  <span className="text-xs text-gray-500">{msToHM(ms)}</span>
                  <div className="h-1.5 w-20 rounded-full bg-gray-100 dark:bg-gray-700">
                    <div
                      className={`h-1.5 rounded-full ${PALETTE[index % PALETTE.length]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs text-gray-400">{pct}%</span>
                </div>
              )
            })}
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
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Today&apos;s Timeline</h2>
      <div className="relative h-12 overflow-hidden rounded-lg bg-gray-50 dark:bg-gray-900">
        {todaySessions.map((s, index) => {
          const startMin = (new Date(s.startedAt).getHours() - START_HOUR) * 60 + new Date(s.startedAt).getMinutes()
          const durMin = s.actualMs / 60000
          const left = Math.max(0, (startMin / totalMinutes) * 100)
          const width = Math.min(100 - left, (durMin / totalMinutes) * 100)
          return (
            <div
              key={s.id}
              className={`absolute bottom-2 top-2 rounded opacity-80 ${PALETTE[index % PALETTE.length]}`}
              style={{
                left: `${left}%`,
                width: `${Math.max(width, 0.5)}%`,
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
