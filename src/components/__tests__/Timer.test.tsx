import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

let keepScreenAwake = false

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      focusDuration: 25,
      breakDuration: 5,
      soundEnabled: false,
      calendarSync: false,
      darkMode: false,
      keepScreenAwake,
      autoStartBreak: false,
      todoistAutoComplete: true,
      accentColor: '#BE6E45',
    },
    updateSettings: vi.fn(),
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

beforeEach(() => {
  keepScreenAwake = false
  vi.clearAllMocks()
  vi.mocked(localStore.getRecentCategoryNames).mockReturnValue([])
  vi.mocked(localStore.markCategoryUsed).mockImplementation((categoryName: string) => [categoryName])

  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
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
      return new Response(JSON.stringify(timerState()), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

describe('Timer', () => {
  it('renders the handoff idle focus surface', async () => {
    render(<Timer />)

    expect(await screen.findByRole('button', { name: 'Start focus' })).toBeTruthy()
    expect(screen.getByText('Focus')).toBeTruthy()
    expect(screen.getByText('Break')).toBeTruthy()
    expect(screen.getByText('25:00')).toBeTruthy()
    expect(screen.getByText('25 minute focus')).toBeTruthy()
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

    expect(await screen.findByText('in session')).toBeTruthy()
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
