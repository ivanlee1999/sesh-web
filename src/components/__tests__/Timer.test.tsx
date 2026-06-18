import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'

let keepScreenAwake = false
let autoStartBreak = false
let timerApiState: Record<string, unknown>
let visibilityStateValue: DocumentVisibilityState = 'visible'
const updateSettings = vi.fn()

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      focusDuration: 25,
      breakDuration: 5,
      soundEnabled: false,
      calendarSync: false,
      darkMode: false,
      keepScreenAwake,
      autoStartBreak,
      todoistAutoComplete: true,
      accentColor: '#BE6E45',
    },
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
  timerApiState = timerState()
  visibilityStateValue = 'visible'
  vi.useRealTimers()
  vi.clearAllMocks()
  updateSettings.mockReset()
  vi.mocked(localStore.getRecentCategoryNames).mockReturnValue([])
  vi.mocked(localStore.markCategoryUsed).mockImplementation((categoryName: string) => [categoryName])

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
    if (url.includes('/api/todoist/tasks')) {
      return new Response(JSON.stringify({
        tasks: [{
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
        }],
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

    expect(await screen.findByRole('button', { name: 'Start focus' })).toBeTruthy()
    expect(screen.getByText('Focus')).toBeTruthy()
    expect(screen.getByText('Break')).toBeTruthy()
    expect(screen.getByText('25:00')).toBeTruthy()
    expect(screen.getByText('Focus length')).toBeTruthy()
    expect(screen.queryByText('Full dial = 60 min')).toBeNull()
    expect(screen.getByText('Add an intention (optional)')).toBeTruthy()
  })

  it('renders category chips and respects recency order', async () => {
    vi.mocked(localStore.getRecentCategoryNames).mockReturnValue(['study', 'work'])

    render(<Timer />)

    const selector = await screen.findByTestId('timer-category-selector')
    const labels = Array.from(selector.querySelectorAll('button')).map(button => button.textContent?.trim())
    expect(labels.slice(0, 2)).toEqual(['Study', 'Work'])
  })

  it('sets an optional intention from the sheet', async () => {
    render(<Timer />)

    fireEvent.click(await screen.findByText('Add an intention (optional)'))
    const textarea = await screen.findByPlaceholderText(/Draft the Q3 strategy memo/)
    fireEvent.change(textarea, { target: { value: 'Review design handoff' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set intention' }))

    expect(screen.getByText('Review design handoff')).toBeTruthy()
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

    const progressCircle = dial.parentElement?.querySelectorAll('circle')[1] as SVGCircleElement | undefined
    const faceFill = screen.getByTestId('timer-duration-face-fill') as HTMLDivElement

    expect(screen.getByText('30:00')).toBeTruthy()
    expect(screen.queryByText('Full dial = 60 min')).toBeNull()
    expect(progressCircle?.getAttribute('stroke-dashoffset')).not.toEqual(progressCircle?.getAttribute('stroke-dasharray'))
    expect(faceFill?.style.background).toContain('conic-gradient(')
    expect(faceFill?.style.background).not.toContain('from -90deg')
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
    fireEvent.click(await screen.findByRole('button', { name: 'Break' }))

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

    const progressCircle = dial.parentElement?.querySelectorAll('circle')[1] as SVGCircleElement | undefined
    const faceFill = screen.getByTestId('timer-duration-face-fill') as HTMLDivElement

    expect(screen.getByText('15:00')).toBeTruthy()
    expect(screen.queryByText('Break dial = 30 min')).toBeNull()
    expect(progressCircle?.getAttribute('stroke-dashoffset')).not.toEqual(progressCircle?.getAttribute('stroke-dasharray'))
    expect(faceFill?.style.background).toContain('conic-gradient(')
    expect(faceFill?.style.background).not.toContain('from -90deg')
    expect(updateSettings).toHaveBeenCalledWith({ breakDuration: 15 })
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

    fireEvent.click(await screen.findByRole('button', { name: 'Break' }))

    expect(screen.getByRole('button', { name: 'Start break' })).toBeTruthy()
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

    fireEvent.click(await screen.findByRole('button', { name: 'Start focus' }))

    expect(await screen.findByText('Remaining')).toBeTruthy()
    expect(screen.getByLabelText('Stop session')).toBeTruthy()
    expect(screen.getByLabelText('Pause session')).toBeTruthy()
  })

  it('opens the reflection flow before saving a stopped focus session', async () => {
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start focus' }))
    fireEvent.click(await screen.findByLabelText('Stop session'))

    expect(await screen.findByText('Session complete')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to journal' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/sessions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"rating":4'),
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

    expect(screen.getByText('Overtime')).toBeTruthy()
    expect(screen.getByText('+01:00')).toBeTruthy()
    expect(screen.queryByText('Session complete')).toBeNull()

    fireEvent.click(screen.getByLabelText('Stop session'))
    expect(screen.getByText('Session complete')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save to journal' }))
      await flushPromises()
    })

    const postCall = vi.mocked(globalThis.fetch).mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      return url === '/api/sessions' && init?.method === 'POST'
    })
    expect(postCall?.[1]?.body).toEqual(expect.stringContaining('"actualMs":1560000'))
    expect(postCall?.[1]?.body).toEqual(expect.stringContaining('"overflowMs":60000'))
  })

  it('returns to the main page after saving reflection even when auto-start-break is enabled', async () => {
    autoStartBreak = true
    render(<Timer />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start focus' }))
    fireEvent.click(await screen.findByLabelText('Stop session'))
    expect(await screen.findByText('Session complete')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save to journal' }))

    expect(await screen.findByRole('button', { name: 'Start focus' })).toBeTruthy()
    expect(screen.queryByText('Break remaining')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start break' })).toBeNull()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Start focus' }))

    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
  })
})
