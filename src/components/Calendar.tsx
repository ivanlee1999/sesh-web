'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { getCategoryMeta } from '@/lib/categories'
import { CatBadge, Icon, ScreenHead, fmtHM, tint, ymd } from './sesh-ui'

function startOfMonth(y: number, m: number) {
  return new Date(y, m, 1)
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate()
}

function sessionMinutes(session: Session) {
  return Math.max(1, Math.round((session.actualMs || session.targetMs || 0) / 60000))
}

function Dots({ n }: { n?: number }) {
  if (!n) return null
  return (
    <div className="flex gap-[3px]">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className="h-[5px] w-[5px] rounded-full" style={{ background: i <= n ? 'var(--accent)' : 'var(--line-strong)' }} />
      ))}
    </div>
  )
}

export default function Calendar() {
  const { categories } = useCategories()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const now = new Date()
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [selectedKey, setSelectedKey] = useState(ymd(now))

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/sessions')
        if (!res.ok) throw new Error('Failed to load sessions')
        const data = await res.json()
        if (!cancelled) setSessions(data)
      } catch {
        if (!cancelled) setError('Failed to load session history.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const byDay = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const session of sessions) {
      const key = ymd(session.startedAt)
      map.set(key, [...(map.get(key) ?? []), session])
    }
    return map
  }, [sessions])

  const monthSessions = sessions.filter(session => {
    const d = new Date(session.startedAt)
    return d.getFullYear() === cursor.y && d.getMonth() === cursor.m
  })
  const monthMin = monthSessions.reduce((sum, session) => sum + sessionMinutes(session), 0)
  const monthDays = new Set(monthSessions.map(session => ymd(session.startedAt))).size
  const maxMonthMin = Math.max(60, ...Array.from(byDay.entries()).map(([, list]) => list.reduce((sum, session) => sum + sessionMinutes(session), 0)))

  const first = startOfMonth(cursor.y, cursor.m)
  const lead = first.getDay()
  const total = daysInMonth(cursor.y, cursor.m)
  const cells: Array<Date | null> = []
  for (let i = 0; i < lead; i += 1) cells.push(null)
  for (let d = 1; d <= total; d += 1) cells.push(new Date(cursor.y, cursor.m, d))

  const dayColor = (key: string) => {
    const list = byDay.get(key)
    if (!list?.length) return null
    const tally = new Map<string, number>()
    for (const session of list) tally.set(session.category, (tally.get(session.category) ?? 0) + sessionMinutes(session))
    const top = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
    return top ? getCategoryMeta(top, categories).color : 'var(--accent)'
  }

  const selectedSessions = [...(byDay.get(selectedKey) ?? [])].sort((a, b) => b.startedAt - a.startedAt)
  const selectedDate = (() => {
    const [y, m, d] = selectedKey.split('-').map(Number)
    return new Date(y, m, d)
  })()
  const selectedTotal = selectedSessions.reduce((sum, session) => sum + sessionMinutes(session), 0)
  const isFuture = (d: Date) => d > new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const shift = (dir: number) => {
    setCursor(current => {
      let m = current.m + dir
      let y = current.y
      if (m < 0) { m = 11; y -= 1 }
      if (m > 11) { m = 0; y += 1 }
      return { y, m }
    })
  }

  return (
    <div className="h-full overflow-y-auto pb-[calc(110px+var(--safe-b))]">
      <ScreenHead title="Calendar" />

      <div className="px-[22px] pt-[14px]">
        <div className="mb-4 flex items-center justify-between">
          <button type="button" onClick={() => shift(-1)} className="grid h-[38px] w-[38px] place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]">
            <Icon name="back" size={19} />
          </button>
          <div className="text-center">
            <div className="text-[17px] font-bold tracking-[-0.02em]">{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
            <div className="mt-px text-[12.5px] text-[var(--ink-3)]">{fmtHM(monthMin)} · {monthDays} days</div>
          </div>
          <button type="button" onClick={() => shift(1)} className="grid h-[38px] w-[38px] place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]">
            <Icon name="chevron" size={19} />
          </button>
        </div>

        <div className="mb-2 grid grid-cols-7 gap-1.5">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
            <div key={`${day}-${i}`} className="text-center text-[11.5px] font-semibold text-[var(--ink-3)]">{day}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((date, i) => {
            if (!date) return <div key={i} />
            const key = ymd(date)
            const list = byDay.get(key) ?? []
            const mins = list.reduce((sum, session) => sum + sessionMinutes(session), 0)
            const color = dayColor(key)
            const intensity = mins ? 0.28 + 0.72 * Math.min(1, mins / maxMonthMin) : 0
            const today = key === ymd(now)
            const selected = key === selectedKey
            const future = isFuture(date)
            return (
              <button
                key={key}
                type="button"
                disabled={future}
                onClick={() => setSelectedKey(key)}
                className="relative flex aspect-square items-center justify-center rounded-[var(--r-sm)] p-0"
                style={{
                  cursor: future ? 'default' : 'pointer',
                  border: selected ? '2px solid var(--ink)' : today ? '1.5px solid var(--line-strong)' : '1px solid var(--line)',
                  background: mins && color ? tint(color, Math.round(intensity * 100)) : 'var(--surface)',
                  opacity: future ? 0.4 : 1,
                }}
              >
                <span
                  className="text-[13px]"
                  style={{
                    fontWeight: selected || today ? 700 : 500,
                    color: intensity > 0.55 ? '#fff' : mins && color ? color : 'var(--ink-3)',
                  }}
                >
                  {date.getDate()}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-[22px] pt-6">
        <div className="mb-[13px] flex items-baseline justify-between">
          <span className="text-[15px] font-bold tracking-[-0.01em]">
            {selectedKey === ymd(now) ? 'Today' : selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </span>
          {selectedSessions.length > 0 && <span className="text-[12.5px] text-[var(--ink-3)] [font-variant-numeric:tabular-nums]">{fmtHM(selectedTotal)} · {selectedSessions.length}</span>}
        </div>

        {error && <div className="rounded-[var(--r-lg)] border border-[#C2615A]/20 bg-[#C2615A]/10 p-4 text-[14px] text-[#C2615A]">{error}</div>}
        {loading && !error && selectedSessions.length === 0 && <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-5 text-center text-[14px] text-[var(--ink-3)]">Loading sessions...</div>}
        {!loading && !error && selectedSessions.length === 0 ? (
          <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-5 py-[34px] text-center text-[var(--ink-3)]">
            <Icon name="calendar" size={26} color="var(--ink-3)" />
            <div className="mt-[10px] text-[14.5px]">No sessions this day.</div>
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {selectedSessions.map(session => {
              const meta = getCategoryMeta(session.category, categories)
              const time = new Date(session.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
              return (
                <div key={session.id} className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-4 py-[15px]" style={{ borderLeft: `3px solid ${meta.color}` }}>
                  <div className={`flex items-center gap-[10px] ${session.notes ? 'mb-[9px]' : ''}`}>
                    <CatBadge category={meta} size="sm" />
                    {session.intention && <span className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.02em]">{session.intention}</span>}
                  </div>
                  {session.notes && <p className="mb-[10px] mt-0 text-[14px] leading-normal text-[var(--ink-2)]">{session.notes}</p>}
                  <div className="flex items-center gap-3 text-[12.5px] text-[var(--ink-3)]">
                    <span className="[font-variant-numeric:tabular-nums]">{time}</span>
                    <span>·</span>
                    <span className="[font-variant-numeric:tabular-nums]">{fmtHM(sessionMinutes(session))}</span>
                    <div className="flex-1" />
                    <Dots n={session.rating} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
