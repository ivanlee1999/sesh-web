'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Session } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { getCategoryMeta } from '@/lib/categories'
import { isAuthResponse, readApiError, redirectToLogin } from '@/lib/api-client'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { hoursMinutes, pad2 } from '@/lib/modernist'
import { loadCalendarView, saveCalendarView, type CalendarView } from '@/lib/local-store'
import { MdIcon } from './md/icons'
import { useShellStatus } from './md/shell-status'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The day view's strip runs 06:00–21:59, wide enough for most working days. */
const HOUR_FROM = 6
const HOUR_TO = 21

/** Width of the week grid's hour column. */
const HOUR_GUTTER = 30

const VIEWS: { key: CalendarView; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
]

function dayKey(input: Date | number): string {
  const d = input instanceof Date ? input : new Date(input)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Monday-first, matching the day-of-week header. */
function startOfWeek(date: Date): Date {
  const d = startOfDay(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * Step whole months, keeping the day of the month.
 *
 * `setMonth` alone skips: from 31 August it lands on 1 October, because 31
 * September does not exist. Building from the 1st and then clamping the day to
 * the new month's length steps to 30 September instead — and paging away and
 * back returns you to the day you were on, rather than to the 1st.
 */
function addMonths(date: Date, months: number): Date {
  const day = date.getDate()
  const d = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d
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
  const [view, setView] = useState<CalendarView>('month')
  const [selected, setSelected] = useState<Date>(() => startOfDay(new Date()))
  /** How far the body has been dragged, in px, while a swipe is in progress. */
  const [dragX, setDragX] = useState(0)
  const draggingRef = useRef(false)

  useEffect(() => {
    setView(loadCalendarView() ?? 'month')
  }, [])

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

  const minutesOn = useCallback((date: Date) => (byDay.get(dayKey(date)) ?? [])
    .reduce((sum, s) => sum + sessionMinutes(s), 0), [byDay])

  /** One step of whatever the current view shows. */
  const shift = useCallback((dir: number) => {
    setSelected(current => (view === 'month'
      ? addMonths(current, dir)
      : addDays(current, dir * (view === 'week' ? 7 : 1))))
  }, [view])

  /**
   * Drag the body sideways to move a period.
   *
   * The whole pane follows the pointer so the gesture is visibly connected to
   * what it does, then either commits past the threshold or springs back. A
   * short drag is a misfire, not a tiny navigation.
   */
  const SWIPE_THRESHOLD = 64

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only a real drag; a tap on a day still selects it.
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const originX = event.clientX
    draggingRef.current = false

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - originX
      if (!draggingRef.current && Math.abs(dx) > 6) draggingRef.current = true
      if (draggingRef.current) setDragX(dx)
    }

    const finish = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      const dx = upEvent.clientX - originX
      setDragX(0)
      if (Math.abs(dx) >= SWIPE_THRESHOLD) shift(dx < 0 ? 1 : -1)
      // Let the click that follows through only if nothing was dragged.
      window.setTimeout(() => { draggingRef.current = false }, 0)
    }

    const cancel = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      setDragX(0)
      draggingRef.current = false
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  const pickDay = (date: Date) => {
    // A drag that ended on a cell must not also select it.
    if (draggingRef.current) return
    setSelected(date)
  }

  // ── What the current view covers ────────────────────────────────────────

  const monthCells = useMemo(() => {
    const first = new Date(selected.getFullYear(), selected.getMonth(), 1)
    const lead = (first.getDay() + 6) % 7
    const daysInMonth = new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate()
    return Array.from({ length: 42 }, (_, i) => {
      const dayNumber = i - lead + 1
      const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth
      return {
        key: `cell-${i}`,
        dayNumber,
        inMonth,
        date: new Date(selected.getFullYear(), selected.getMonth(), dayNumber),
      }
    })
  }, [selected])

  const weekDays = useMemo(() => {
    const from = startOfWeek(selected)
    return Array.from({ length: 7 }, (_, i) => addDays(from, i))
  }, [selected])

  /**
   * The hours the week's grid covers.
   *
   * Derived from the work rather than fixed at 00–24, which would spend most
   * of the pane on hours nobody worked. Padded by an hour either side, floored
   * at a six-hour span so a single short session still gets a readable grid,
   * and defaulted to a working day when the week is empty.
   */
  const weekRange = useMemo(() => {
    const inWeek = weekDays.flatMap(d => byDay.get(dayKey(d)) ?? [])
    if (inWeek.length === 0) return { from: 8, to: 18 }

    let first = 24
    let last = 0
    for (const session of inWeek) {
      const start = new Date(session.startedAt)
      const end = new Date(session.startedAt + Math.max(session.actualMs, 60000))
      first = Math.min(first, start.getHours())
      last = Math.max(last, end.getHours() + (end.getMinutes() > 0 ? 1 : 0))
    }
    const from = Math.max(0, first - 1)
    const to = Math.min(24, Math.max(last + 1, from + 6))
    return { from, to: Math.max(to, from + 6) }
  }, [byDay, weekDays])

  /** Every session in the week, placed by its real start and length. */
  const weekBlocks = useMemo(() => {
    const spanMinutes = (weekRange.to - weekRange.from) * 60
    return weekDays.map(date => {
      const dayStart = date.getTime()
      const blocks = (byDay.get(dayKey(date)) ?? []).map(session => {
        const startMin = (session.startedAt - dayStart) / 60000 - weekRange.from * 60
        const lengthMin = Math.max(session.actualMs, 60000) / 60000
        const top = (startMin / spanMinutes) * 100
        const height = (lengthMin / spanMinutes) * 100
        return {
          session,
          // Clamped so a session that ran past the grid still shows where it
          // began, rather than being drawn outside the column.
          top: Math.max(0, Math.min(100, top)),
          height: Math.max(1.4, Math.min(100 - Math.max(0, top), height)),
          color: getCategoryMeta(session.category, categories).color,
        }
      })
      return { date, blocks }
    })
  }, [byDay, categories, weekDays, weekRange])

  /** Label every other hour, or every third on a long span. */
  const weekHourLines = useMemo(() => {
    const span = weekRange.to - weekRange.from
    const step = span > 12 ? 3 : 2
    const lines: { hour: number; top: number }[] = []
    for (let hour = weekRange.from; hour <= weekRange.to; hour += step) {
      lines.push({ hour, top: ((hour - weekRange.from) / span) * 100 })
    }
    return lines
  }, [weekRange])

  const periodLabel = useMemo(() => {
    if (view === 'month') return selected.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    if (view === 'day') return selected.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    const from = weekDays[0]
    const to = weekDays[6]
    const sameMonth = from.getMonth() === to.getMonth()
    return sameMonth
      ? `${from.getDate()}–${to.getDate()} ${from.toLocaleDateString(undefined, { month: 'long' })}`
      : `${from.getDate()} ${from.toLocaleDateString(undefined, { month: 'short' })} – ${to.getDate()} ${to.toLocaleDateString(undefined, { month: 'short' })}`
  }, [selected, view, weekDays])

  /** Total across whatever the view is showing, not always the month. */
  const periodMinutes = useMemo(() => {
    if (view === 'day') return minutesOn(selected)
    if (view === 'week') return weekDays.reduce((sum, d) => sum + minutesOn(d), 0)
    return sessions
      .filter(s => {
        const d = new Date(s.startedAt)
        return d.getFullYear() === selected.getFullYear() && d.getMonth() === selected.getMonth()
      })
      .reduce((sum, s) => sum + sessionMinutes(s), 0)
  }, [minutesOn, selected, sessions, view, weekDays])

  useEffect(() => {
    reportSub('calendar', `${periodLabel} · ${hoursMinutes(periodMinutes)}`)
  }, [periodLabel, periodMinutes, reportSub])

  const daySessions = useMemo(
    () => [...(byDay.get(dayKey(selected)) ?? [])].sort((a, b) => a.startedAt - b.startedAt),
    [byDay, selected],
  )

  /*
   * Month and week are overviews, so their list shows what fits and counts the
   * rest — nothing scrolls, as everywhere else.
   *
   * The day view is the exception, and has to be: it is the log of one day,
   * its length is whatever that day was, and a fixed row budget cannot know
   * how tall the pane is. On a short viewport — an iOS phone with Safari's
   * chrome, most of all — the budget overran the pane and `overflow: hidden`
   * quietly cut the list off, taking the "+N more" line with it, so the extra
   * sessions were neither shown nor counted nor reachable. It scrolls and
   * shows all of them instead.
   */
  const dayList = view === 'day'
  const shown = dayList ? daySessions : daySessions.slice(0, phone ? 4 : 7)
  const hidden = daySessions.length - shown.length

  /** Where the day's work actually fell, for the day view's strip. */
  const hours = useMemo(() => {
    const from = selected.getTime()
    return Array.from({ length: HOUR_TO - HOUR_FROM + 1 }, (_, i) => {
      const start = from + (HOUR_FROM + i) * 3600000
      const end = start + 3600000
      let minutes = 0
      let color = 'var(--accent-base)'
      let best = 0
      for (const session of daySessions) {
        if (session.type !== 'focus') continue
        const overlap = Math.min(end, session.startedAt + session.actualMs) - Math.max(start, session.startedAt)
        if (overlap <= 0) continue
        minutes += overlap / 60000
        if (overlap > best) {
          best = overlap
          color = getCategoryMeta(session.category, categories).color
        }
      }
      return { minutes, color }
    })
  }, [categories, daySessions, selected])

  const navButton = (label: string, dir: number, icon: 'prev' | 'next') => (
    <button
      type="button"
      className="btn btn-icon md-press-sm"
      aria-label={label}
      onClick={() => shift(dir)}
    >
      <MdIcon name={icon} size={15} strokeWidth={2} />
    </button>
  )

  const todayKey = dayKey(new Date())

  const monthCell = (date: Date, inMonth: boolean, label: string) => {
    const list = byDay.get(dayKey(date)) ?? []
    const active = dayKey(date) === dayKey(selected)
    const today = dayKey(date) === todayKey
    const bars = list.slice(0, 4)
    return (
      <button
        key={dayKey(date) + label}
        type="button"
        className="md-press"
        disabled={!inMonth}
        aria-label={date.toDateString()}
        aria-pressed={active}
        onClick={() => inMonth && pickDay(date)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '4px 2px',
          cursor: inMonth ? 'pointer' : 'default',
          border: 0,
          background: 'transparent',
          color: inMonth ? 'inherit' : 'var(--color-text-3)',
          fontFamily: 'inherit',
          opacity: inMonth ? 1 : 0.35,
          minHeight: 0,
        }}
      >
        {/* The selection is a tonal pill behind the numeral; today is the
            accent, so the two states never fight for the same fill. */}
        <span
          className="md-num"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: 'var(--r-md)',
            fontSize: 13,
            fontWeight: today ? 700 : 500,
            background: active ? 'var(--fill-3)' : 'transparent',
            color: today ? 'var(--accent-base)' : 'inherit',
            boxShadow: active && today ? 'inset 0 0 0 1.5px var(--accent-base)' : undefined,
            transition: 'background 160ms',
          }}
        >
          {label}
        </span>
        <span style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 14 }}>
          {bars.map((session, k) => (
            <span
              key={session.id}
              style={{
                display: 'block',
                width: 3,
                height: 4 + k * 3,
                borderRadius: 1.5,
                background: getCategoryMeta(session.category, categories).color,
              }}
            />
          ))}
        </span>
      </button>
    )
  }

  const bodyStyle: CSSProperties = {
    flex: view === 'day' ? 'none' : 1,
    minHeight: 0,
    // Follows the pointer while dragging, then springs back or commits.
    transform: dragX ? `translateX(${dragX * 0.45}px)` : undefined,
    transition: dragX ? 'none' : 'transform 260ms var(--ease-out)',
    touchAction: 'pan-y',
    cursor: 'grab',
  }

  return (
    <div className="md-screen md-screen-col" data-testid="calendar-screen">
      {phone && (
        <h2 className="md-title" style={{ padding: '14px 18px 4px', fontSize: 24, flex: 'none' }}>Calendar</h2>
      )}

      <div
        style={{
          padding: phone ? '10px 14px 8px' : '14px 20px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          flex: 'none',
        }}
      >
        {navButton(`Previous ${view}`, -1, 'prev')}
        <span className="md-title" style={{ fontSize: 17, minWidth: phone ? 0 : 150, textAlign: 'center', padding: '0 4px' }}>
          {periodLabel}
        </span>
        {navButton(`Next ${view}`, 1, 'next')}
        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 2,
          }}
        >
          {VIEWS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="md-quiet md-press"
              data-active={view === key ? 'true' : 'false'}
              aria-pressed={view === key}
              onClick={() => { setView(key); saveCalendarView(key) }}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {error && (
        <div style={{ padding: '0 18px 10px', color: 'var(--warn)', fontSize: 12.5, fontWeight: 600, flex: 'none' }}>
          {error}
        </div>
      )}

      {view === 'month' && (
        <div className="md-rule-b" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', flex: 'none', padding: phone ? '0 6px' : '0 12px' }}>
          {DOW.map(label => (
            <span
              key={label}
              className="md-eyebrow"
              style={{
                padding: '6px 0 7px',
                textAlign: 'center',
                fontSize: 10.5,
              }}
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {view === 'week' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${HOUR_GUTTER}px repeat(7,1fr)`,
            borderBottom: '1px solid var(--line)',
            flex: 'none',
          }}
        >
          <span />
          {weekDays.map(date => {
            const active = dayKey(date) === dayKey(selected)
            const today = dayKey(date) === todayKey
            return (
              <button
                key={dayKey(date)}
                type="button"
                className="md-press"
                aria-pressed={active}
                aria-label={date.toDateString()}
                onClick={() => pickDay(date)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  padding: '6px 0 7px',
                  border: 0,
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <span className="md-eyebrow" style={{ fontSize: 10, color: today ? 'var(--accent-base)' : undefined }}>
                  {DOW[(date.getDay() + 6) % 7]}
                </span>
                <span
                  className="md-num"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    fontSize: 13.5,
                    fontWeight: today ? 700 : 500,
                    background: active ? 'var(--fill-3)' : 'transparent',
                    color: today ? 'var(--accent-base)' : 'inherit',
                    transition: 'background 160ms',
                  }}
                >
                  {date.getDate()}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div onPointerDown={onPointerDown} style={bodyStyle}>
        {view === 'month' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridAutoRows: '1fr', height: '100%' }}>
            {monthCells.map(cell => monthCell(cell.date, cell.inMonth, cell.inMonth ? String(cell.dayNumber) : ''))}
          </div>
        )}

        {view === 'week' && (
          <div
            style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: `${HOUR_GUTTER}px repeat(7,1fr)`,
              height: '100%',
              minHeight: 0,
            }}
          >
            {/* Hour references, drawn behind the work. Only every second or
                third hour: enough to read a start time from, without laying a
                grid over the thing you came to look at. */}
            {weekHourLines.map(line => (
              <div
                key={line.hour}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: HOUR_GUTTER,
                  right: 0,
                  top: `${line.top}%`,
                  height: 1,
                  background: 'var(--line)',
                  pointerEvents: 'none',
                }}
              />
            ))}

            <div data-testid="week-hours" style={{ position: 'relative' }}>
              {weekHourLines.map(line => (
                <span
                  key={line.hour}
                  className="md-num"
                  style={{
                    position: 'absolute',
                    top: `${line.top}%`,
                    right: 6,
                    transform: 'translateY(-50%)',
                    fontSize: 10.5,
                    fontWeight: 500,
                    letterSpacing: 0,
                    color: 'var(--color-text-3)',
                  }}
                >
                  {pad2(line.hour)}
                </span>
              ))}
            </div>

            {weekBlocks.map(({ date, blocks }) => (
              <button
                key={dayKey(date)}
                type="button"
                aria-label={`${date.toDateString()} — ${blocks.length} session${blocks.length === 1 ? '' : 's'}`}
                onClick={() => pickDay(date)}
                style={{
                  position: 'relative',
                  border: 0,
                  background: dayKey(date) === dayKey(selected)
                    ? 'var(--color-accent-100)'
                    : 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  minHeight: 0,
                  transition: 'background 160ms var(--ease-out)',
                }}
              >
                {blocks.map(block => (
                  <span
                    key={block.session.id}
                    title={`${block.session.intention || getCategoryMeta(block.session.category, categories).label} · ${hoursMinutes(sessionMinutes(block.session))}`}
                    style={{
                      position: 'absolute',
                      left: 2,
                      right: 2,
                      top: `${block.top}%`,
                      height: `${block.height}%`,
                      borderRadius: 3,
                      // A break is rest, not work, so it reads as an outline.
                      background: block.session.type === 'break' ? 'transparent' : block.color,
                      boxShadow: block.session.type === 'break' ? `inset 0 0 0 1.5px ${block.color}` : undefined,
                      opacity: block.session.type === 'break' ? 0.7 : 0.9,
                    }}
                  />
                ))}
              </button>
            ))}
          </div>
        )}

        {view === 'day' && (
          <div style={{ padding: '6px 18px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'flex', gap: 2, height: 26, padding: 3, borderRadius: 'var(--r-sm)', background: 'var(--fill-1)' }}>
              {hours.map((hour, i) => (
                <span
                  key={i}
                  style={{
                    display: 'block',
                    flex: 1,
                    borderRadius: 3,
                    background: hour.minutes > 0 ? hour.color : 'transparent',
                    opacity: hour.minutes > 0 ? Math.min(0.9, 0.25 + (hour.minutes / 60) * 0.65) : 0,
                  }}
                />
              ))}
            </span>
            <span
              className="md-num"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                letterSpacing: 0,
                color: 'var(--color-text-3)',
                fontWeight: 500,
              }}
            >
              <span>{pad2(HOUR_FROM)}</span>
              <span>{pad2(HOUR_FROM + 5)}</span>
              <span>{pad2(HOUR_FROM + 10)}</span>
              <span>{pad2(HOUR_TO + 1)}</span>
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          padding: '12px 18px 4px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          borderTop: '1px solid var(--line)',
          flex: 'none',
        }}
      >
        <h3 className="md-title" style={{ margin: 0, fontSize: 15 }}>
          {selected.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
        </h3>
        <span className="md-meta">
          {daySessions.length === 0
            ? 'No sessions'
            : `${daySessions.length} session${daySessions.length === 1 ? '' : 's'} · ${hoursMinutes(minutesOn(selected))}`}
        </span>
      </div>

      <div
        className={dayList ? 'md-stagger md-scroll' : 'md-stagger'}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: dayList ? 1 : 'none',
          minHeight: 0,
          ...(dayList ? null : { overflow: 'hidden' }),
        }}
      >
        {shown.map(session => {
          const meta = getCategoryMeta(session.category, categories)
          const time = new Date(session.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
          return (
            <div
              key={session.id}
              className="md-hairline"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '8px 18px 9px',
                '--hairline-inset': '77px',
              } as CSSProperties}
            >
              <span
                className="md-num md-meta"
                style={{ paddingTop: 2, minWidth: 44, letterSpacing: 0 }}
              >
                {time}
              </span>
              <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: meta.color, display: 'block' }} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>
                  {session.intention || meta.label}
                </span>
                <span className="md-meta">
                  {meta.label}{session.type === 'break' ? ' · Break' : ''}
                </span>
              </span>
              <span className="md-num" style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14 }}>
                {hoursMinutes(sessionMinutes(session))}
              </span>
            </div>
          )
        })}
        {hidden > 0 && (
          <div className="md-meta" style={{ padding: '8px 18px 10px' }}>
            +{hidden} more that day
          </div>
        )}
      </div>
    </div>
  )
}
