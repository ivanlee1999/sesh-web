import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import Calendar from '../Calendar'

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [{ id: '1', name: 'work', label: 'Work', color: '#ec3013', sortOrder: 0, isDefault: true }],
    byName: {},
    loading: false,
    error: null,
    refresh: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  }),
}))

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Mid-month and mid-week, so a step in either direction is unambiguous. */
const TODAY = new Date(2026, 7, 19, 10, 0, 0)

/** A focus session on a given day at a given wall-clock time. */
function session(id: string, day: number, hour: number, minutes: number, type: 'focus' | 'break' = 'focus') {
  const startedAt = new Date(2026, 7, day, hour, 0, 0).getTime()
  return {
    id,
    intention: `Session ${id}`,
    category: 'work',
    type,
    targetMs: minutes * 60000,
    actualMs: minutes * 60000,
    overflowMs: 0,
    startedAt,
    endedAt: startedAt + minutes * 60000,
    notes: '',
  }
}

/** The seven day columns of the week grid, in order. */
function weekColumns() {
  return screen.getAllByRole('button').filter(b => /— \d+ session/.test(b.getAttribute('aria-label') ?? ''))
}

function blocksIn(column: HTMLElement) {
  return Array.from(column.querySelectorAll('span'))
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  // shouldAdvanceTime: the calendar renders synchronously, but a frozen clock
  // would also freeze anything the testing library waits on.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TODAY)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]))
})

/** A horizontal pointer drag across the calendar body. */
function swipe(distance: number) {
  const body = document.querySelector('[data-testid="calendar-screen"] [style*="translateX"], [data-testid="calendar-screen"] div[style*="pan-y"]')
    ?? screen.getByTestId('calendar-screen')
  fireEvent.pointerDown(body, { clientX: 400, button: 0, pointerType: 'mouse' })
  fireEvent(window, new MouseEvent('pointermove', { clientX: 400 + distance }))
  fireEvent(window, new MouseEvent('pointerup', { clientX: 400 + distance }))
}

function renderCalendar() {
  render(<Calendar />)
  expect(screen.getByTestId('calendar-screen')).toBeTruthy()
}

describe('Calendar views', () => {
  it('opens on the month, showing the whole month', async () => {
    renderCalendar()
    expect(screen.getByText('August 2026')).toBeTruthy()
  })

  it('switches to a week, labelled by its range', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))

    // 19 Aug 2026 is a Wednesday, so the Monday-first week is the 17th–23rd.
    expect(screen.getByText('17–23 August')).toBeTruthy()
  })

  it('switches to a single day', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Day' }))

    // The hour strip only exists in the day view, and its labels do not move
    // with the locale the way a formatted date does.
    expect(screen.getByText('06')).toBeTruthy()
    expect(screen.getByText('22')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows every session of a long day, rather than capping the log', async () => {
    // Twelve on one day: past the old fixed budget, which cut the list off
    // inside an overflow-hidden pane and took the counter with it.
    const many = Array.from({ length: 12 }, (_, i) => session(`s${i}`, 19, 6 + i, 25))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(many))

    renderCalendar()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Day' }))

    for (let i = 0; i < 12; i += 1) {
      expect(screen.getByText(`Session s${i}`)).toBeTruthy()
    }
    expect(screen.queryByText(/more that day/)).toBeNull()
  })

  it('lets the day log scroll, since nothing else on the screen can', async () => {
    const many = Array.from({ length: 12 }, (_, i) => session(`s${i}`, 19, 6 + i, 25))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(many))

    renderCalendar()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Day' }))

    const log = screen.getByText('Session s0').closest('.md-stagger')
    expect(log?.classList.contains('md-scroll')).toBe(true)
    expect((log as HTMLElement).style.overflow).toBe('')
  })

  it('still caps and counts the list on the month, which is an overview', async () => {
    const many = Array.from({ length: 12 }, (_, i) => session(`s${i}`, 19, 6 + i, 25))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(many))

    renderCalendar()
    await act(async () => {})

    expect(screen.getByText(/more that day/)).toBeTruthy()
    const log = screen.getByText('Session s0').closest('.md-stagger') as HTMLElement
    expect(log.classList.contains('md-scroll')).toBe(false)
    expect(log.style.overflow).toBe('hidden')
  })

  it('remembers the view for next time', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    expect(localStorage.getItem('sesh:calendarView')).toBe('week')
  })

  it('steps by whatever the current view shows', async () => {
    renderCalendar()

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByText('September 2026')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByText('24–30 August')).toBeTruthy()
  })

  it('does not skip a month stepping from a 31-day one', async () => {
    // From 31 August a naive setMonth(+1) lands on 1 October, because there is
    // no 31 September.
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Day' }))
    for (let i = 0; i < 12; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Next day' }))

    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByText('September 2026')).toBeTruthy()
  })

  it('keeps the day you were on when paging months away and back', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))

    // Back on 19 August, not stranded on the 1st.
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    expect(screen.getByText('17–23 August')).toBeTruthy()
  })
})

describe('dragging the calendar', () => {
  it('moves forward when dragged left, and back when dragged right', async () => {
    renderCalendar()

    swipe(-120)
    expect(screen.getByText('September 2026')).toBeTruthy()

    swipe(120)
    expect(screen.getByText('August 2026')).toBeTruthy()
  })

  it('springs back rather than navigating on a short drag', async () => {
    renderCalendar()

    // Below the threshold: a nudge is a misfire, not a tiny navigation.
    swipe(-20)
    expect(screen.getByText('August 2026')).toBeTruthy()
  })

  it('drags by the unit the current view shows', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))

    swipe(-120)
    expect(screen.getByText('24–30 August')).toBeTruthy()
  })
})

describe('the week grid', () => {
  /** Two sessions on Wednesday the 19th, plus one on Thursday. */
  function withSessions() {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([
      session('a', 19, 9, 60),
      session('b', 19, 14, 30),
      session('c', 20, 11, 90),
    ]))
  }

  /** Renders, switches to the week, and lets the session fetch land. */
  async function openWeek() {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    // The response and its .json() are each a microtask.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
  }

  it('gives every day of the week a column', async () => {
    withSessions()
    await openWeek()
    expect(weekColumns()).toHaveLength(7)
  })

  it('places a later session lower than an earlier one on the same day', async () => {
    withSessions()
    await openWeek()

    // Wednesday is the third column of a Monday-first week.
    const blocks = blocksIn(weekColumns()[2])
    expect(blocks).toHaveLength(2)

    const top = (el: Element) => parseFloat((el as HTMLElement).style.top)
    // 09:00 sits above 14:00.
    expect(top(blocks[0])).toBeLessThan(top(blocks[1]))
  })

  it('makes a longer session a taller block', async () => {
    withSessions()
    await openWeek()

    const height = (el: Element) => parseFloat((el as HTMLElement).style.height)
    const wed = blocksIn(weekColumns()[2])
    // 60 minutes against 30, in the same grid.
    expect(height(wed[0])).toBeGreaterThan(height(wed[1]))
  })

  it('draws a break as an outline, since rest is not work', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([
      session('focus', 19, 9, 60),
      session('rest', 19, 10, 15, 'break'),
    ]))
    await openWeek()

    const [work, rest] = blocksIn(weekColumns()[2]) as HTMLElement[]
    expect(work.style.background).not.toBe('transparent')
    expect(rest.style.background).toBe('transparent')
    expect(rest.style.boxShadow).toContain('inset')
  })

  it('follows the work when setting the hour range', async () => {
    // Everything late in the day: the grid should not still start at 08.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([session('late', 19, 19, 60)]))
    await openWeek()

    // Scoped to the gutter: day numbers in the header collide with hours.
    const hours = within(screen.getByTestId('week-hours')).getAllByText(/\d\d/).map(el => el.textContent)
    // An hour before the first session, and nowhere near a default morning.
    expect(hours[0]).toBe('18')
    expect(hours).not.toContain('08')
  })

  it('falls back to a working day when the week is empty', async () => {
    await openWeek()
    expect(screen.getByText('08')).toBeTruthy()
  })

  it('selects a day by its column, and the list below follows', async () => {
    withSessions()
    await openWeek()

    // Thursday the 20th, where session c sits.
    fireEvent.click(weekColumns()[3])
    expect(screen.getByText(/1 session/)).toBeTruthy()
  })
})
