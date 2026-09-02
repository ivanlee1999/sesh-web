'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Session } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { getCategoryMeta } from '@/lib/categories'
import { isAuthResponse, readApiError, redirectToLogin } from '@/lib/api-client'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { hoursMinutes } from '@/lib/modernist'
import { useShellStatus } from './md/shell-status'

interface ServerAnalytics {
  todayMs: number
  todayCount: number
  streak: number
  days: { label: string; ms: number }[]
}

/** The strip runs 08:00–20:59, so the four labels land on real hour edges. */
const TIMELINE_FROM = 8
const TIMELINE_TO = 20

export default function Analytics() {
  const { categories } = useCategories()
  const { reportSub } = useShellStatus()
  const isDesktop = useIsDesktop()
  const phone = !isDesktop
  const [stats, setStats] = useState<ServerAnalytics | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
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
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const days = useMemo(() => stats?.days ?? [], [stats])
  const weekTotalMs = days.reduce((sum, day) => sum + day.ms, 0)
  const maxDayMs = Math.max(1, ...days.map(day => day.ms))

  useEffect(() => {
    reportSub('insights', `${hoursMinutes(weekTotalMs / 60000)} over 7 days`)
  }, [reportSub, weekTotalMs])

  const weekStart = useMemo(() => Date.now() - 6 * 24 * 60 * 60 * 1000, [])

  const focusWeek = useMemo(
    () => sessions.filter(s => s.type === 'focus' && s.startedAt >= weekStart),
    [sessions, weekStart],
  )

  /** How close the week's sittings landed to what they were set to run for. */
  const plannedVsActual = useMemo(() => {
    const planned = focusWeek.reduce((sum, s) => sum + (s.targetMs || 0), 0)
    if (planned <= 0) return '—'
    const actual = focusWeek.reduce((sum, s) => sum + (s.actualMs || 0), 0)
    return `${Math.round((actual / planned) * 100)}%`
  }, [focusWeek])

  const breakdown = useMemo(() => {
    const grouped = new Map<string, number>()
    for (const session of focusWeek) {
      grouped.set(session.category, (grouped.get(session.category) ?? 0) + session.actualMs)
    }
    const total = Array.from(grouped.values()).reduce((sum, ms) => sum + ms, 0)
    return Array.from(grouped.entries())
      .map(([name, ms]) => ({
        name,
        ms,
        pct: total > 0 ? Math.round((ms / total) * 100) : 0,
        ...getCategoryMeta(name, categories),
      }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 4)
  }, [categories, focusWeek])

  /** Today's sittings laid out hour by hour, so the shape of the day shows. */
  const timeline = useMemo(() => {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const todaySessions = sessions.filter(s => s.type === 'focus' && s.startedAt >= startOfDay.getTime())

    const hours: { minutes: number; color: string }[] = []
    for (let hour = TIMELINE_FROM; hour <= TIMELINE_TO; hour += 1) {
      const from = startOfDay.getTime() + hour * 3600000
      const to = from + 3600000
      let minutes = 0
      let color = 'var(--accent-base)'
      let best = 0
      for (const session of todaySessions) {
        const overlap = Math.min(to, session.startedAt + session.actualMs) - Math.max(from, session.startedAt)
        if (overlap <= 0) continue
        minutes += overlap / 60000
        if (overlap > best) {
          best = overlap
          color = getCategoryMeta(session.category, categories).color
        }
      }
      hours.push({ minutes, color })
    }
    return hours
  }, [categories, sessions])

  const statCells = [
    { value: hoursMinutes((stats?.todayMs ?? 0) / 60000), label: 'Focused today', accent: true },
    { value: String(stats?.todayCount ?? 0), label: 'Sessions today', accent: false },
    { value: String(stats?.streak ?? 0), label: 'Day streak', accent: false },
    { value: plannedVsActual, label: 'Planned vs actual', accent: false },
  ]

  const sectionHead: CSSProperties = { margin: 0 }

  return (
    <div className="md-screen md-screen-col" data-testid="insights-screen">
      {phone && (
        <h2 className="md-title" style={{ padding: '14px 18px 10px', fontSize: 24, flex: 'none' }}>Insights</h2>
      )}

      {error && (
        <div style={{ padding: '10px 18px', color: 'var(--warn)', fontSize: 13, fontWeight: 500, flex: 'none' }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: phone ? 'repeat(2,1fr)' : 'repeat(4,1fr)',
          // One rule under the whole strip rather than a border on each tile:
          // the figures are already in a grid, and boxing each one turned four
          // numbers into eight lines.
          borderBottom: '1px solid var(--line)',
          flex: 'none',
        }}
      >
        {statCells.map(cell => (
          <div
            key={cell.label}
            style={{
              padding: '14px 18px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <span
              className="md-num"
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 500,
                fontSize: 30,
                letterSpacing: '-.02em',
                lineHeight: 1,
                color: cell.accent ? 'var(--accent-base)' : 'var(--color-text)',
              }}
            >
              {cell.value}
            </span>
            <span className="md-meta">
              {cell.label}
            </span>
          </div>
        ))}
      </div>

      <div style={{ padding: '16px 18px 8px', display: 'flex', alignItems: 'baseline', gap: 10, flex: 'none' }}>
        <h3 className="md-eyebrow" style={sectionHead}>Last 7 days</h3>
        <span className="md-num md-meta" style={{ marginLeft: 'auto' }}>
          {hoursMinutes(weekTotalMs / 60000)} this week
        </span>
      </div>

      <div
        style={{
          padding: '0 18px',
          display: 'flex',
          alignItems: 'flex-end',
          // Wider gutters on the desktop, so seven bars across a 1280px pane
          // stay bars rather than becoming one slab with slits in it.
          gap: phone ? 8 : 22,
          height: phone ? 104 : 150,
          flex: 'none',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {days.map((day, i) => {
          const today = i === days.length - 1
          return (
            <div
              key={`${day.label}-${i}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch', height: '100%', gap: 6 }}
            >
              <span
                className="md-bar"
                aria-label={`${day.label}: ${hoursMinutes(day.ms / 60000)}`}
                style={{
                  display: 'block',
                  borderRadius: 2,
                  background: today ? 'var(--accent-base)' : 'var(--color-text)',
                  height: `${Math.max(2, (day.ms / maxDayMs) * 100)}%`,
                  opacity: day.ms === 0 ? 0.12 : today ? 1 : 0.7,
                  animationDelay: `${i * 55}ms`,
                }}
              />
              <span
                className="md-meta"
                style={{
                  textAlign: 'center',
                  color: today ? 'var(--accent-base)' : undefined,
                  paddingBottom: 8,
                }}
              >
                {day.label.slice(0, 1)}
              </span>
            </div>
          )
        })}
      </div>

      <div style={{ padding: '16px 18px 6px', flex: 'none' }}>
        <h3 className="md-eyebrow" style={sectionHead}>Where it went</h3>
      </div>
      <div style={{ padding: '0 18px 12px', display: 'flex', flexDirection: 'column', gap: 10, flex: 'none' }}>
        {breakdown.length === 0 && (
          <span style={{ fontSize: 14, color: 'var(--color-text-2)' }}>No sessions yet this week.</span>
        )}
        {breakdown.map((row, i) => (
          <div key={row.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 500 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: row.color, display: 'block', flex: 'none' }} />
              {row.label}
              <span className="md-num md-meta" style={{ marginLeft: 'auto' }}>
                {hoursMinutes(row.ms / 60000)} · {row.pct}%
              </span>
            </span>
            <span style={{ height: 6, borderRadius: 2, background: 'var(--fill-2)', display: 'block', overflow: 'hidden' }}>
              <span
                className="md-track-fill"
                style={{ display: 'block', height: '100%', width: `${row.pct}%`, borderRadius: 2, background: row.color, animationDelay: `${i * 70}ms` }}
              />
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 'auto', padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 'none' }}>
        <h3 className="md-eyebrow" style={sectionHead}>Today, hour by hour</h3>
        <span style={{ display: 'flex', height: 24, padding: 3, gap: 2, borderRadius: 'var(--r-sm)', background: 'var(--fill-1)' }}>
          {timeline.map((hour, i) => (
            <span
              key={i}
              style={{
                display: 'block',
                flex: 1,
                borderRadius: 2,
                background: hour.minutes > 0 ? hour.color : 'transparent',
                // A ten-minute sitting should still register, so the floor is
                // well above zero once anything happened at all.
                opacity: hour.minutes > 0 ? Math.min(0.9, 0.25 + (hour.minutes / 60) * 0.65) : 0,
              }}
            />
          ))}
        </span>
        <span className="md-num md-meta" style={{ display: 'flex', justifyContent: 'space-between', padding: '0 3px' }}>
          <span>08</span><span>12</span><span>16</span><span>20</span>
        </span>
      </div>
    </div>
  )
}
