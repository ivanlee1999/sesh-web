import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'

let keepScreenAwake = false
let autoStartBreak = false
let autoStartFocus = false
let timerApiState: Record<string, unknown>
let visibilityStateValue: DocumentVisibilityState = 'visible'
/** Whether the fake Todoist is configured — off by default, as it is on a bare install. */
let todoistConfigured = false
const updateSettings = vi.fn()

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      focusDuration: 25,
      breakDuration: 5,
      longBreakDuration: 15,
      sessionsBeforeLongBreak: 4,
      soundEnabled: false,
      calendarSync: false,
      darkMode: false,
      keepScreenAwake,
      autoStartBreak,
      autoStartFocus,
      todoistEnabled: true,
      accentColor: '#BE6E45',
    },
    loaded: true,
    updateSettings,
  }),
}))

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [
      { id: '1', name: 'work', label: 'Work', color: '#3b82f6', sortOrder: 0, isDefault: true },
      { id: '2', name: 'study', label: 'Study', color: '#8b5cf6', sortOrder: 1, isDefault: false },
    ],
    byName: {
      work: { id: '1', name: 'work', label: 'Work', color: '#3b82f6', sortOrder: 0, isDefault: true },
      study: { id: '2', name: 'study', label: 'Study', color: '#8b5cf6', sortOrder: 1, isDefault: false },
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  }),
}))

vi.mock('@/lib/local-store', () => ({
  saveTimerState: vi.fn(),
  loadTimerState: vi.fn(() => null),
  clearTimerState: vi.fn(),
  enqueueSession: vi.fn(),
  getSessionQueue: vi.fn(() => []),
  removeQueuedSession: vi.fn(),
  cacheCategories: vi.fn(),
  getCachedCategories: vi.fn(() => null),
  getRecentCategoryNames: vi.fn(() => []),
  markCategoryUsed: vi.fn((categoryName: string) => [categoryName]),
  getPomodoroCycleCount: vi.fn(() => 0),
  incrementPomodoroCycle: vi.fn(() => 1),
  enqueueFocusTime: vi.fn(),
  getFocusTimeQueue: vi.fn(() => []),
  removeQueuedFocusTime: vi.fn(),
  markFocusTimeAttempt: vi.fn(),
  MAX_FOCUS_TIME_ATTEMPTS: 5,
}))

import Timer from '../Timer'
import * as localStore from '@/lib/local-store'

function timerState(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'idle',
    sessionType: 'focus',
    intention: '',
    category: 'work',
    targetMs: 25 * 60 * 1000,
    remainingMs: 25 * 60 * 1000,
    overflowMs: 0,
    startedAt: null,
    pausedAt: null,
    updatedAt: Date.now(),
    todoistTaskId: null,
    ...overrides,
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  keepScreenAwake = false
  autoStartBreak = false
  autoStartFocus = false
  timerApiState = timerState()
  visibilityStateValue = 'visible'
  todoistConfigured = false
  vi.useRealTimers()
  vi.clearAllMocks()
  updateSettings.mockReset()
  vi.mocked(localStore.getRecentCategoryNames).mockReturnValue([])
  vi.mocked(localStore.markCategoryUsed).mockImplementation((categoryName: string) => [categoryName])
  vi.mocked(localStore.getPomodoroCycleCount).mockReturnValue(0)
  vi.mocked(localStore.incrementPomodoroCycle).mockReturnValue(1)
  vi.mocked(localStore.getFocusTimeQueue).mockReturnValue([])

  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityStateValue,
  })

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  })

  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: undefined,
  })

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/api/timer')) {
      return new Response(JSON.stringify(timerApiState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/analytics')) {
      return new Response(JSON.stringify({ streak: 3, todayMs: 0, todayCount: 0, days: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/todoist/status')) {
      return new Response(JSON.stringify({ configured: todoistConfigured }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/todoist/tasks')) {
      return new Response(JSON.stringify({
        tasks: [
          {
            id: 't1',
            content: 'Draft memo',
            duration: null,
            labels: ['work'],
            priority: 1,
            projectName: 'Work',
            due: 'today',
            dueLabel: 'Today',
            category: 'work',
            completed: false,
          },
          {
            id: 't2',
            content: 'Book the room',
            duration: null,
            labels: ['work'],
            priority: 4,
            projectName: 'Work',
            due: 'today',
            dueLabel: 'Today',
            category: 'work',
            completed: false,
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })

  Object.defineProperty(globalThis, 'Notification', {
    value: { permission: 'default' },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Timer', () => {
  it('renders the handoff idle focus surface', async () => {
    render(<Timer />)

    expect(await screen.findByRole('button', { name: /^Start Focus/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Focus 25 min' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Short break 5 min' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Long break 15 min' })).toBeTruthy()
    expect(screen.getByText('25:00')).toBeTruthy()
    expect(screen.getByText('25 min planned')).toBeTruthy()
    expect(screen.getByPlaceholderText('What are you working on?')).toBeTruthy()
  })

  it('renders category chips and respects recency order', async () => {
    vi.mocked(localStore.getRecentCategoryNames).mockReturnValue(['study', 'work'])

    render(<Timer />)

    const selector = await screen.findByTestId('timer-category-selector')
    const labels = Array.from(selector.querySelectorAll('button')).map(button => button.textContent?.trim())
    expect(labels.slice(0, 2)).toEqual(['Study', 'Work'])
  })

  it('edits the optional intention inline, with no sheet', async () => {
    render(<Timer />)

    const field = await screen.findByPlaceholderText('What are you working on?') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Review design handoff' } })

    expect(field.value).toBe('Review design handoff')
    expect(screen.queryByRole('button', { name: 'Set intention' })).toBeNull()

    fireEvent.change(field, { target: { value: '' } })
    expect(field.value).toBe('')
  })

  it('lets you drag the idle clock arrow to change focus length', async () => {
    render(<Timer />)

    const dial = await screen.findByTestId('timer-duration-dial')
    vi.spyOn(dial, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(dial, { clientX: 150, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 150, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 150, clientY: 300, pointerId: 1 })

    const progressArc = dial.querySelector('circle') as SVGCircleElement | null

    expect(screen.getByText('30:00')).toBeTruthy()
    expect(progressArc?.getAttribute('stroke-dashoffset')).not.toEqual(progressArc?.getAttribute('stroke-dasharray'))
    expect(updateSettings).toHaveBeenCalledWith({ focusDuration: 30 })
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/timer',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"targetMs":1800000'),
        }),
      )
    })
  })

  it('lets you drag the idle clock arrow to change break length', async () => {
    render(<Timer />)
    fireEvent.click(await screen.findByRole('button', { name: 'Short break 5 min' }))

    const dial = await screen.findByTestId('timer-duration-dial')
    vi.spyOn(dial, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(dial, { clientX: 150, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 150, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 150, clientY: 300, pointerId: 1 })

    const progressArc = dial.querySelector('circle') as SVGCircleElement | null

    expect(screen.getByText('30:00')).toBeTruthy()
    expect(progressArc?.getAttribute('stroke-dashoffset')).not.toEqual(progressArc?.getAttribute('stroke-dasharray'))
    expect(updateSettings).toHaveBeenCalledWith({ breakDuration: 30 })
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/timer',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"sessionType":"break"'),
        }),
      )
    })
  })

  it('switches to break mode and syncs the idle server state', async () => {
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: 'Short break 5 min' }))

    expect(screen.getByRole('button', { name: /^Start Short break/ })).toBeTruthy()
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/timer',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"sessionType":"break"'),
        }),
      )
    })
  })

  it('starts an immersive session from the focus button', async () => {
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))

    expect(await screen.findByText('Remaining')).toBeTruthy()
    expect(screen.getByLabelText('Finish session')).toBeTruthy()
    expect(screen.getByLabelText('Pause session')).toBeTruthy()
  })

  it('opens the reflection flow before saving a stopped focus session', async () => {
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))
    fireEvent.click(await screen.findByLabelText('Finish session'))

    expect(await screen.findByText('Session logged')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back to the dial/ }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/sessions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"rating":0'),
        }),
      )
    })
  })

  it('keeps an overdue focus session running and shows overtime after the target passes', async () => {
    vi.useFakeTimers()
    const base = new Date('2026-06-15T14:00:00.000Z')
    vi.setSystemTime(base)
    timerApiState = timerState({
      phase: 'running',
      sessionType: 'focus',
      intention: 'Write weekly review',
      category: 'work',
      startedAt: base.getTime(),
      updatedAt: base.getTime(),
      targetMs: 25 * 60 * 1000,
      remainingMs: 25 * 60 * 1000,
    })

    render(<Timer />)
    await act(async () => {
      await flushPromises()
    })

    vi.setSystemTime(base.getTime() + 26 * 60 * 1000)
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    await act(async () => {
      await flushPromises()
    })

    expect(screen.getAllByText('Overtime').length).toBeGreaterThan(0)
    expect(screen.getByText('+01:00')).toBeTruthy()
    expect(screen.queryByText('Session logged')).toBeNull()

    fireEvent.click(screen.getByLabelText('Finish session'))
    expect(screen.getByText('Session logged')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Back to the dial/ }))
      await flushPromises()
    })

    const postCall = vi.mocked(globalThis.fetch).mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      return url === '/api/sessions' && init?.method === 'POST'
    })
    expect(postCall?.[1]?.body).toEqual(expect.stringContaining('"actualMs":1560000'))
    expect(postCall?.[1]?.body).toEqual(expect.stringContaining('"overflowMs":60000'))
  })

  /** Sets up an already-overdue break and returns control after the catch-up. */
  async function renderOverdueBreak() {
    vi.useFakeTimers()
    const base = new Date('2026-06-15T14:00:00.000Z')
    vi.setSystemTime(base)
    timerApiState = timerState({
      phase: 'running',
      sessionType: 'break',
      intention: '',
      category: 'work',
      startedAt: base.getTime(),
      updatedAt: base.getTime(),
      targetMs: 5 * 60 * 1000,
      remainingMs: 5 * 60 * 1000,
    })

    render(<Timer />)
    await act(async () => {
      await flushPromises()
    })

    vi.setSystemTime(base.getTime() + 6 * 60 * 1000)
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    await act(async () => {
      await flushPromises()
    })
  }

  it('keeps an overdue break running and counts the extra rest', async () => {
    await renderOverdueBreak()

    expect(screen.getAllByText('Overtime').length).toBeGreaterThan(0)
    expect(screen.getByText('+01:00')).toBeTruthy()
    // The break must not end itself out from under you.
    expect(screen.queryByRole('button', { name: /^Start Focus/ })).toBeNull()
  })

  it('returns to idle when an overrunning break is stopped', async () => {
    await renderOverdueBreak()

    // findBy* would hang here: the suite runs on fake timers.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Finish session'))
      await flushPromises()
    })

    expect(screen.getByRole('button', { name: /^Start Focus/ })).toBeTruthy()
    // Breaks are not reflected on.
    expect(screen.queryByText('Session logged')).toBeNull()
  })

  it('still ends the break at zero when auto-start focus is on', async () => {
    autoStartFocus = true
    await renderOverdueBreak()

    expect(screen.queryAllByText('Overtime')).toHaveLength(0)
    expect(screen.getByText('Remaining')).toBeTruthy()
  })

  it('starts the break the moment focus ends, without waiting for the reflection', async () => {
    autoStartBreak = true
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))
    fireEvent.click(await screen.findByLabelText('Finish session'))

    // The reflection is shown, but rest is already counting behind it.
    expect(await screen.findByText('Session logged')).toBeTruthy()
    expect(screen.getByText('Your break is already running.')).toBeTruthy()
    expect(screen.getByText('Remaining')).toBeTruthy()
    expect(screen.getByText('05:00')).toBeTruthy()
    expect(vi.mocked(localStore.incrementPomodoroCycle)).toHaveBeenCalledTimes(1)
  })

  it('records the focus session before the reflection is answered', async () => {
    // The reflection is no longer a wall: you are on a break and can walk away
    // from it. The session itself must not depend on answering.
    autoStartBreak = true
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))
    fireEvent.click(await screen.findByLabelText('Finish session'))
    await screen.findByText('Session logged')

    const posted = vi.mocked(globalThis.fetch).mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      return url === '/api/sessions' && init?.method === 'POST'
    })
    expect(posted).toHaveLength(1)
    expect(posted[0][1]?.body).toEqual(expect.stringContaining('"rating":0'))

    // Answering it re-posts the same id, which the API upserts. The rating
    // click needs its own act, or Save still reads the previous state.
    fireEvent.click(screen.getByRole('button', { name: 'Focused' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Start next session/ }))
      await flushPromises()
    })

    const all = vi.mocked(globalThis.fetch).mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      return url === '/api/sessions' && init?.method === 'POST'
    })
    expect(all).toHaveLength(2)
    expect(all[1][1]?.body).toEqual(expect.stringContaining('"rating":5'))
    // Same session, so the second write updates rather than duplicates.
    const idOf = (body: unknown) => JSON.parse(String(body)).id
    expect(idOf(all[0][1]?.body)).toBe(idOf(all[1][1]?.body))
  })

  it('keeps the auto-started break ticking', async () => {
    // Regression: finish() clears the tick interval, and the phase stays
    // 'running' across the hand-off — so the break used to sit frozen.
    // Fake timers must be installed before the interval is created, which
    // rules out findBy* here.
    autoStartBreak = true
    vi.useFakeTimers()
    render(<Timer />)
    await act(async () => { await flushPromises() })

    fireEvent.click(screen.getByRole('button', { name: /^Start Focus/ }))
    await act(async () => { await flushPromises() })
    fireEvent.click(screen.getByLabelText('Finish session'))
    await act(async () => { await flushPromises() })

    expect(screen.getByText('Session logged')).toBeTruthy()
    expect(screen.getByText('05:00')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(2000) })

    expect(screen.queryByText('05:00')).toBeNull()
    expect(screen.getByText('04:58')).toBeTruthy()
  })

  it('leaves the running break in place when the reflection is saved', async () => {
    autoStartBreak = true
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))
    fireEvent.click(await screen.findByLabelText('Finish session'))
    await screen.findByText('Session logged')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Back to the dial/ }))
      await flushPromises()
    })

    expect(screen.queryByText('Session logged')).toBeNull()
    expect(screen.getByText('Remaining')).toBeTruthy()
    // Counted once at the end of focus, not again on save.
    expect(vi.mocked(localStore.incrementPomodoroCycle)).toHaveBeenCalledTimes(1)
  })

  it('skipping the reflection also leaves the break running', async () => {
    autoStartBreak = true
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))
    fireEvent.click(await screen.findByLabelText('Finish session'))
    await screen.findByText('Session logged')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Back to the dial/ }))
      await flushPromises()
    })

    expect(screen.queryByText('Session logged')).toBeNull()
    expect(screen.getByText('Remaining')).toBeTruthy()
  })

  it('starts a long break after the final focus session of a cycle', async () => {
    autoStartBreak = true
    vi.mocked(localStore.getPomodoroCycleCount).mockReturnValue(3)
    vi.mocked(localStore.incrementPomodoroCycle).mockReturnValue(4)
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))
    fireEvent.click(await screen.findByLabelText('Finish session'))

    expect(await screen.findByText('Session logged')).toBeTruthy()
    expect(screen.getByText('15:00')).toBeTruthy()
    expect(screen.getByText(/^Long break ·/)).toBeTruthy()
  })

  it('returns to idle after reflection when auto-start-break is disabled', async () => {
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))
    fireEvent.click(await screen.findByLabelText('Finish session'))
    expect(await screen.findByText('Session logged')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Back to the dial/ }))

    expect(await screen.findByRole('button', { name: /^Start Focus/ })).toBeTruthy()
    expect(screen.queryByText('Break remaining')).toBeNull()
  })

  it('auto-starts the next focus when a break ends and auto-start-focus is enabled', async () => {
    vi.useFakeTimers()
    autoStartFocus = true
    render(<Timer />)
    await act(async () => {
      await flushPromises()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Short break 5 min' }))
    fireEvent.click(screen.getByRole('button', { name: /^Start Short break/ }))
    expect(screen.getByText('Remaining')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
      await flushPromises()
    })

    expect(screen.getByText('Remaining')).toBeTruthy()
    expect(screen.getByText('25:00')).toBeTruthy()
  })

  it('reconciles the running timer from the server when the app becomes visible again', async () => {
    vi.useFakeTimers()
    const base = new Date('2026-06-15T12:00:00.000Z')
    vi.setSystemTime(base)
    timerApiState = timerState({
      phase: 'running',
      startedAt: base.getTime(),
      updatedAt: base.getTime(),
      targetMs: 25 * 60 * 1000,
      remainingMs: 25 * 60 * 1000,
    })

    render(<Timer />)
    await act(async () => {
      await flushPromises()
    })

    expect(screen.getByText('25:00')).toBeTruthy()

    vi.setSystemTime(base.getTime() + 65_000)
    visibilityStateValue = 'hidden'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    visibilityStateValue = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      await flushPromises()
    })

    const timerFetches = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      return url.includes('/api/timer')
    })
    expect(timerFetches).toHaveLength(2)
    expect(screen.getByText('23:55')).toBeTruthy()
  })

  it('reconciles the running timer from the server on pageshow', async () => {
    vi.useFakeTimers()
    const base = new Date('2026-06-15T13:00:00.000Z')
    vi.setSystemTime(base)
    timerApiState = timerState({
      phase: 'running',
      startedAt: base.getTime(),
      updatedAt: base.getTime(),
      targetMs: 25 * 60 * 1000,
      remainingMs: 25 * 60 * 1000,
    })

    render(<Timer />)
    await act(async () => {
      await flushPromises()
    })

    expect(screen.getByText('25:00')).toBeTruthy()

    vi.setSystemTime(base.getTime() + 30_000)
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    await act(async () => {
      await flushPromises()
    })

    const timerFetches = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      return url.includes('/api/timer')
    })
    expect(timerFetches).toHaveLength(2)
    expect(screen.getByText('24:30')).toBeTruthy()
  })

  it('rewrites the focus topic in place on the running screen', async () => {
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))

    // The title line is the field — no overlay, and the clock stays put.
    const topic = await screen.findByLabelText('Session topic') as HTMLInputElement
    expect(screen.getByText('Remaining')).toBeTruthy()
    expect(screen.getByLabelText('Finish session')).toBeTruthy()

    fireEvent.change(topic, { target: { value: 'Read the spec' } })
    fireEvent.blur(topic)

    expect(topic.value).toBe('Read the spec')
    await waitFor(() => {
      const put = vi.mocked(globalThis.fetch).mock.calls.find(([input, init]) => {
        const url = typeof input === 'string' ? input : (input as Request).url
        return url === '/api/timer' && init?.method === 'PUT' && String(init?.body).includes('Read the spec')
      })
      expect(put?.[1]?.body).toEqual(expect.stringContaining('"phase":"running"'))
    })
  })

  it('carries a mid-session topic rewrite into the saved session', async () => {
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))
    const topic = await screen.findByLabelText('Session topic')
    fireEvent.change(topic, { target: { value: 'Read the spec' } })
    fireEvent.blur(topic)

    fireEvent.click(await screen.findByLabelText('Finish session'))
    fireEvent.click(await screen.findByRole('button', { name: /Back to the dial/ }))

    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([input, init]) => {
        const url = typeof input === 'string' ? input : (input as Request).url
        return url === '/api/sessions' && init?.method === 'POST'
      })
      expect(post?.[1]?.body).toEqual(expect.stringContaining('"intention":"Read the spec"'))
    })
  })

  it('requests screen wake lock directly from the start tap when keep-awake is enabled', async () => {
    keepScreenAwake = true
    const sentinel = new EventTarget() as EventTarget & {
      released: boolean
      type: 'screen'
      release: () => Promise<void>
    }
    sentinel.released = false
    sentinel.type = 'screen'
    sentinel.release = vi.fn(async () => {})
    const request = vi.fn(async () => sentinel)
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    })

    render(<Timer />)
    fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))

    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
  })

  describe('working several tasks in one session', () => {
    /** Open the picker and select the two open tasks. */
    async function pickBothTasks() {
      render(<Timer />)
      fireEvent.click(await screen.findByRole('button', { name: /^Choose$|^Change$/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Add Draft memo to the session' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Add Book the room to the session' }))
    }

    it('keeps the picker open so a second task can be added without reopening it', async () => {
      todoistConfigured = true
      await pickBothTasks()

      // The sheet stays open, and the slot behind it names both.
      expect(await screen.findByRole('button', { name: 'Remove Draft memo from the session' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Remove Book the room from the session' })).toBeTruthy()
      expect(screen.getAllByText('Draft memo · Book the room').length).toBeGreaterThan(0)
    })

    it('names every picked task in the topic', async () => {
      todoistConfigured = true
      await pickBothTasks()
      fireEvent.click(screen.getByLabelText('Close task picker'))

      const field = await screen.findByLabelText('Session intention')
      expect((field as HTMLInputElement).value).toBe('Draft memo · Book the room')
    })

    it('starts the session against both tasks', async () => {
      todoistConfigured = true
      await pickBothTasks()
      fireEvent.click(screen.getByLabelText('Close task picker'))
      fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))

      await waitFor(() => {
        const put = vi.mocked(globalThis.fetch).mock.calls.find(([input, init]) => {
          const url = typeof input === 'string' ? input : (input as Request).url
          return url === '/api/timer' && init?.method === 'PUT'
            && String(init?.body).includes('"todoistTaskId":"t1,t2"')
        })
        expect(put).toBeTruthy()
      })
    })

    it('drops one task without disturbing the other', async () => {
      todoistConfigured = true
      await pickBothTasks()
      fireEvent.click(screen.getByLabelText('Close task picker'))

      fireEvent.click(await screen.findByRole('button', { name: 'Remove Draft memo from the session' }))

      const field = await screen.findByLabelText('Session intention')
      await waitFor(() => expect((field as HTMLInputElement).value).toBe('Book the room'))
    })

    const posted = (path: string) => vi.mocked(globalThis.fetch).mock.calls.some(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      return url === path && init?.method === 'POST'
    })

    /** Pick both tasks, run a session and save it. */
    async function runAndSaveSession() {
      await pickBothTasks()
      fireEvent.click(screen.getByLabelText('Close task picker'))
      fireEvent.click(await screen.findByRole('button', { name: /^Start Focus/ }))
      fireEvent.click(await screen.findByLabelText('Finish session'))
      fireEvent.click(await screen.findByRole('button', { name: /Back to the dial/ }))
    }

    it('logs the time to every task in the session', async () => {
      todoistConfigured = true
      await runAndSaveSession()

      await waitFor(() => {
        expect(posted('/api/todoist/tasks/t1/duration')).toBe(true)
        expect(posted('/api/todoist/tasks/t2/duration')).toBe(true)
      })
    })

    it('never ticks a task off — finishing a session is not finishing the work', async () => {
      todoistConfigured = true
      await runAndSaveSession()

      await waitFor(() => expect(posted('/api/todoist/tasks/t1/duration')).toBe(true))
      expect(posted('/api/todoist/tasks/t1/close')).toBe(false)
      expect(posted('/api/todoist/tasks/t2/close')).toBe(false)
    })

    it('queues focused minutes the provider refused, rather than losing them', async () => {
      todoistConfigured = true
      const realFetch = vi.mocked(globalThis.fetch).getMockImplementation()!
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url
        if (url.includes('/duration')) {
          return new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' })
        }
        return realFetch(input, init)
      })

      await runAndSaveSession()

      await waitFor(() => {
        expect(vi.mocked(localStore.enqueueFocusTime)).toHaveBeenCalledTimes(2)
      })
      const queued = vi.mocked(localStore.enqueueFocusTime).mock.calls.map(([entry]) => entry.taskRef)
      expect(queued).toEqual(['t1', 't2'])
      // The gateway's HTML page must not reach the notice — see lib/api-client.
      expect(await screen.findByText(/502 Bad Gateway/)).toBeTruthy()
      expect(screen.queryByText(/<html>/)).toBeNull()
    })

    it('offers no tasks at all once Todoist is the only source and it is unconfigured', async () => {
      render(<Timer />)
      await screen.findByRole('button', { name: /^Start Focus/ })

      expect(screen.queryByRole('button', { name: /^Choose$|^Change$/ })).toBeNull()
    })
  })
})
