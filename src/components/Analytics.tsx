'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Session } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { getCategoryMeta } from '@/lib/categories'
import { isAuthResponse, readApiError, redirectToLogin } from '@/lib/api-client'
import { Icon, ScreenHead, fmtHM, msToHM, tint } from './sesh-ui'

interface ServerAnalytics {
  todayMs: number
  todayCount: number
  streak: number
  days: { label: string; ms: number }[]
}

function StatCard({ value, label, icon, accent }: { value: string | number; label: string; icon: Parameters<typeof Icon>[0]['name']; accent?: boolean }) {
  return (
    <div className="flex-1 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-[17px] py-4">
      <Icon name={icon} size={19} color={accent ? 'var(--accent)' : 'var(--ink-3)'} />
      {/* Keyed on value so the number pops whenever the stat refreshes. */}
      <div key={String(value)} className="anim-number-pop mt-3 text-[27px] font-bold leading-none tracking-[-0.035em] [font-variant-numeric:tabular-nums]">{value}</div>
      <div className="mt-[5px] text-[12.5px] text-[var(--ink-3)]">{label}</div>
    </div>
  )
}

function InsightsSkeleton() {
  return (
    <div className="card-grid" aria-hidden="true">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="skeleton rounded-[var(--r-lg)]" style={{ height: i === 1 ? 210 : 108 }} />
      ))}
    </div>
  )
}

export default function Analytics() {
  const { categories } = useCategories()
  const [stats, setStats] = useState<ServerAnalytics | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState(6)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [analyticsRes, sessionsRes] = await Promise.all([
          fetch('/api/analytics'),
          fetch('/api/sessions'),
        ])
        if (!analyticsRes.ok || !sessionsRes.ok) {
          const failed = !analyticsRes.ok ? analyticsRes : sessionsRes
          const message = await readApiError(
            failed,
            !analyticsRes.ok ? 'Failed to load analytics' : 'Failed to load sessions',
          )
          if (isAuthResponse(failed)) redirectToLogin()
          throw new Error(message)
        }
        const [analytics, sessionData] = await Promise.all([analyticsRes.json(), sessionsRes.json()])
        if (!cancelled) {
          setStats(analytics)
          setSessions(sessionData)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load insights.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const days = stats?.days ?? []
  const maxMs = Math.max(60 * 60000, ...days.map(day => day.ms))
  const weekTotalMs = days.reduce((sum, day) => sum + day.ms, 0)

  const categoryRows = useMemo(() => {
    const weekStart = Date.now() - 6 * 24 * 60 * 60 * 1000
    const focus = sessions.filter(session => session.type === 'focus' && session.startedAt >= weekStart)
    const grouped = new Map<string, number>()
    for (const session of focus) {
      grouped.set(session.category, (grouped.get(session.category) ?? 0) + session.actualMs)
    }
    const rows = Array.from(grouped.entries()).map(([name, ms]) => ({
      name,
      ms,
      ...getCategoryMeta(name, categories),
    }))
    return rows.sort((a, b) => b.ms - a.ms)
  }, [categories, sessions])

  const catMax = Math.max(1, ...categoryRows.map(row => row.ms))
  const topColor = categoryRows[0]?.color ?? 'var(--accent)'
  const totalFocusMin = Math.round(sessions.filter(s => s.type === 'focus').reduce((sum, s) => sum + s.actualMs, 0) / 60000)

  return (
    <div className="h-full w-full min-w-0 overflow-y-auto pb-[var(--screen-bottom-space)]" data-testid="insights-screen">
      <ScreenHead title="Insights" sub="Last 7 days" />

      <div className="flex flex-col gap-[14px] px-[var(--gutter)] py-[14px]">
        {error && <div className="anim-fade-up rounded-[var(--r-lg)] border border-[var(--warn)]/20 bg-[var(--warn)]/10 p-4 text-[14px] text-[var(--warn)]">{error}</div>}
        {loading ? (
          <InsightsSkeleton />
        ) : !error ? (
          <div className="card-grid stagger">
            <div className="card-span-2 flex gap-3">
              <StatCard value={stats?.streak ?? 0} label="day streak" icon="flame" accent />
              <StatCard value={msToHM(stats?.todayMs ?? 0)} label="focused today" icon="timer" />
            </div>

            <div className="card-span-2 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-5 pb-4 pt-5">
              <div className="mb-[18px] flex items-baseline justify-between">
                <div>
                  <div className="text-[22px] font-bold tracking-[-0.03em]">{msToHM(weekTotalMs)}</div>
                  <div className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">this week</div>
                </div>
                {days[selected] && (
                  <div key={selected} className="anim-fade text-right">
                    <div className="text-[13.5px] font-semibold text-[var(--ink-2)] [font-variant-numeric:tabular-nums]">{msToHM(days[selected].ms)}</div>
                    <div className="text-[12px] text-[var(--ink-3)]">{days[selected].label}</div>
                  </div>
                )}
              </div>
              <div className="flex h-[132px] items-end gap-2">
                {days.map((day, i) => (
                  <button
                    key={`${day.label}-${i}`}
                    type="button"
                    aria-label={`${day.label}: ${msToHM(day.ms)}`}
                    aria-pressed={i === selected}
                    onClick={() => setSelected(i)}
                    className="press-sm flex h-full flex-1 cursor-pointer flex-col items-center justify-end gap-2 border-0 bg-transparent p-0"
                  >
                    <span
                      className="grow-bar w-full max-w-[30px] rounded-[7px]"
                      style={{
                        '--i': i,
                        height: Math.max(5, (day.ms / maxMs) * 104),
                        background: i === selected ? topColor : day.ms ? tint(topColor, 38) : 'var(--surface-2)',
                        transition: 'background var(--dur-2) var(--ease-out), height var(--dur-3) var(--ease-out)',
                      } as CSSProperties}
                    />
                    <span className="text-[11.5px] transition-colors" style={{ fontWeight: i === selected ? 700 : 500, color: i === selected ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {day.label.slice(0, 1)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-5 pb-1.5 pt-[18px]">
              <div className="mb-4 text-[13px] uppercase tracking-[0.07em] text-[var(--ink-3)]">By category</div>
              {categoryRows.length > 0 ? categoryRows.map((row, i) => (
                <div key={row.name} className="mb-4">
                  <div className="mb-[7px] flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[14.5px] font-semibold">
                      <span className="h-[9px] w-[9px] rounded-full" style={{ background: row.color }} />
                      {row.label}
                    </span>
                    <span className="text-[13.5px] text-[var(--ink-2)] [font-variant-numeric:tabular-nums]">{msToHM(row.ms)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="grow-track h-full rounded-full"
                      style={{ '--i': i, width: `${(row.ms / catMax) * 100}%`, background: row.color } as CSSProperties}
                    />
                  </div>
                </div>
              )) : (
                <div className="pb-[14px] text-[14px] text-[var(--ink-3)]">No sessions yet this week.</div>
              )}
            </div>

            <div className="flex gap-3">
              <StatCard value={sessions.length} label="total sessions" icon="check" />
              <StatCard value={fmtHM(totalFocusMin)} label="lifetime focus" icon="chart" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
