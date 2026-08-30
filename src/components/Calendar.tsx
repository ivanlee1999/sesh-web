'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { getCategoryMeta } from '@/lib/categories'
import { isAuthResponse, readApiError, redirectToLogin } from '@/lib/api-client'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { hoursMinutes } from '@/lib/modernist'
import { MdIcon } from './md/icons'
import { useShellStatus } from './md/shell-status'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dayKey(input: Date | number): string {
  const d = input instanceof Date ? input : new Date(input)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function sessionMinutes(session: Session): number {
  return Math.max(1, Math.round((session.actualMs || session.targetMs || 0) / 60000))
}

export default function Calendar() {
  const { categories } = useCategories()
  const { reportSub } = useShellStatus()
  const isDesktop = useIsDesktop()
  const phone = !isDesktop
  const [sessions, setSessions] = useState<Session[]>([])
  const [error, setError] = useState<string | null>(null)
  const now = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [selectedKey, setSelectedKey] = useState(dayKey(now))

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError(null)
      try {
        const res = await fetch('/api/sessions')
        if (!res.ok) {
          const message = await readApiError(res, 'Failed to load sessions')
          if (isAuthResponse(res)) redirectToLogin()
          throw new Error(message)
        }
        const data = await res.json()
        if (!cancelled) setSessions(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load session history.')
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const byDay = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const session of sessions) {
      const key = dayKey(session.startedAt)
      map.set(key, [...(map.get(key) ?? []), session])
    }
    return map
  }, [sessions])

  const first = new Date(cursor.y, cursor.m, 1)
  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const monthMinutes = useMemo(() => sessions
    .filter(s => {
      const d = new Date(s.startedAt)
      return d.getFullYear() === cursor.y && d.getMonth() === cursor.m
    })
    .reduce((sum, s) => sum + sessionMinutes(s), 0), [cursor.m, cursor.y, sessions])

  useEffect(() => {
    reportSub('calendar', `${monthLabel} · ${hoursMinutes(monthMinutes)}`)
  }, [monthLabel, monthMinutes, reportSub])

  // Six rows of seven, always — the grid absorbs the slack rather than
  // changing height as you page between months.
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells = Array.from({ length: 42 }, (_, i) => {
    const dayNumber = i - lead + 1
    const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth
    const date = inMonth ? new Date(cursor.y, cursor.m, dayNumber) : null
    return { dayNumber, inMonth, date, key: date ? dayKey(date) : `blank-${i}` }
  })

  const selectedSessions = [...(byDay.get(selectedKey) ?? [])].sort((a, b) => a.startedAt - b.startedAt)
  const selectedTotal = selectedSessions.reduce((sum, s) => sum + sessionMinutes(s), 0)
  const selectedDate = (() => {
    const [y, m, d] = selectedKey.split('-').map(Number)
    return new Date(y, m, d)
  })()

  // Nothing scrolls: the day list shows what fits and counts the rest.
  const listBudget = phone ? 4 : 7
  const shown = selectedSessions.slice(0, listBudget)
  const hidden = selectedSessions.length - shown.length

  const shift = (dir: number) => {
    setCursor(current => {
      let m = current.m + dir
      let y = current.y
      if (m < 0) { m = 11; y -= 1 }
      if (m > 11) { m = 0; y += 1 }
      return { y, m }
    })
  }

  const navButton = (label: string, dir: number, icon: 'prev' | 'next') => (
    <button
      type="button"
      className="md-press md-lift"
      aria-label={label}
      onClick={() => shift(dir)}
      style={{
        flex: 'none',
        width: 26,
        height: 26,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '2px solid var(--color-divider)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <MdIcon name={icon} size={13} strokeWidth={2.4} />
    </button>
  )

  return (
    <div className="md-screen md-screen-col" data-testid="calendar-screen">
      {phone && (
        <h2 className="md-title" style={{ padding: '14px 18px 10px', fontSize: 24, flex: 'none' }}>Calendar</h2>
      )}

      <div
        style={{
          padding: '11px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderBottom: '2px solid var(--color-divider)',
          flex: 'none',
        }}
      >
        {navButton('Previous month', -1, 'prev')}
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {monthLabel}
        </span>
        {navButton('Next month', 1, 'next')}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--color-neutral-600)',
            fontWeight: 700,
          }}
        >
          {hoursMinutes(monthMinutes)} focused
        </span>
      </div>

      {error && (
        <div style={{ padding: '10px 18px', color: 'var(--color-accent)', fontSize: 12.5, fontWeight: 600, flex: 'none' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '2px solid var(--color-divider)', flex: 'none' }}>
        {DOW.map(label => (
          <span
            key={label}
            style={{
              padding: '5px 0',
              textAlign: 'center',
              fontSize: 10,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'var(--color-neutral-600)',
              fontWeight: 700,
            }}
          >
            {label}
          </span>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridAutoRows: '1fr', flex: 1, minHeight: 0 }}>
        {cells.map(cell => {
          const list = cell.date ? byDay.get(cell.key) ?? [] : []
          const active = cell.key === selectedKey
          const bars = list.slice(0, 4)
          return (
            <button
              key={cell.key}
              type="button"
              className="md-press"
              disabled={!cell.inMonth}
              aria-label={cell.date ? cell.date.toDateString() : undefined}
              aria-pressed={active}
              onClick={() => cell.inMonth && setSelectedKey(cell.key)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '8px 0 7px',
                cursor: cell.inMonth ? 'pointer' : 'default',
                border: 0,
                borderRight: '1px solid var(--color-neutral-300)',
                borderBottom: '1px solid var(--color-neutral-300)',
                background: active ? 'var(--color-accent)' : 'transparent',
                color: active ? '#fff' : cell.inMonth ? 'inherit' : 'var(--color-neutral-500)',
                fontFamily: 'inherit',
                opacity: cell.inMonth ? 1 : 0.35,
              }}
            >
              <span className="md-num" style={{ fontSize: 12, fontWeight: 600 }}>
                {cell.inMonth ? cell.dayNumber : ''}
              </span>
              <span style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 14 }}>
                {bars.map((session, k) => (
                  <span
                    key={session.id}
                    style={{
                      display: 'block',
                      width: 3,
                      height: 4 + k * 3,
                      background: active ? '#fff' : getCategoryMeta(session.category, categories).color,
                    }}
                  />
                ))}
              </span>
            </button>
          )
        })}
      </div>

      <div
        style={{
          padding: '10px 18px 4px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          borderTop: '2px solid var(--color-divider)',
          flex: 'none',
        }}
      >
        <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          {selectedDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
        </h3>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-600)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          {selectedSessions.length === 0
            ? 'No sessions'
            : `${selectedSessions.length} session${selectedSessions.length === 1 ? '' : 's'} · ${hoursMinutes(selectedTotal)}`}
        </span>
      </div>

      <div className="md-stagger" style={{ display: 'flex', flexDirection: 'column', flex: 'none', overflow: 'hidden' }}>
        {shown.map(session => {
          const meta = getCategoryMeta(session.category, categories)
          const time = new Date(session.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
          return (
            <div
              key={session.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '7px 18px',
                borderBottom: '1px solid var(--color-neutral-300)',
              }}
            >
              <span
                className="md-num"
                style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', paddingTop: 2, minWidth: 44, fontWeight: 600 }}
              >
                {time}
              </span>
              <span style={{ width: 3, alignSelf: 'stretch', background: meta.color, display: 'block' }} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>
                  {session.intention || meta.label}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    color: 'var(--color-neutral-600)',
                    fontWeight: 700,
                  }}
                >
                  {meta.label}{session.type === 'break' ? ' · Break' : ''}
                </span>
              </span>
              <span className="md-num" style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14 }}>
                {hoursMinutes(sessionMinutes(session))}
              </span>
            </div>
          )
        })}
        {hidden > 0 && (
          <div
            style={{
              padding: '7px 18px 8px',
              borderBottom: '1px solid var(--color-neutral-300)',
              fontSize: 10.5,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--color-neutral-600)',
            }}
          >
            +{hidden} more that day
          </div>
        )}
      </div>
    </div>
  )
}
