import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
