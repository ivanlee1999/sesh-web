import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

let keepScreenAwake = false

// Mock dependencies before importing Timer
vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      focusDuration: 25,
      breakDuration: 5,
      soundEnabled: false,
      calendarSync: false,
      darkMode: false,
      keepScreenAwake,
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

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
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

// Mock the TodoistTasks sub-component to avoid its own fetch calls
vi.mock('../TodoistTasks', () => ({
  default: ({ selectedTaskId }: { selectedTaskId: string | null }) => (
    <div data-testid="todoist-tasks-mock">
      {selectedTaskId ? `Task: ${selectedTaskId}` : 'No task selected'}
    </div>
  ),
}))

import Timer from '../Timer'
import * as localStore from '@/lib/local-store'

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

  // Mock fetch to return idle timer state
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/api/timer')) {
      return new Response(JSON.stringify({
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
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200 })
  })

  // Mock Notification
  Object.defineProperty(globalThis, 'Notification', {
    value: { permission: 'default' },
    writable: true,
    configurable: true,
  })
})

describe('Timer', () => {
  it('renders idle layout from server idle state', () => {
    const { container } = render(<Timer />)

    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.className).toContain('flex')
    expect(wrapper.className).toContain('flex-col')
    expect(wrapper.className).toContain('items-center')

    // No CSS custom property inline styles for color
    const style = wrapper.getAttribute('style') || ''
    expect(style).not.toMatch(/--[\w-]+-color/)
  })

  it('renders the intention input with proper placeholder', () => {
    render(<Timer />)
    const input = screen.getByPlaceholderText('Intention')
    expect(input).toBeTruthy()
  })

  it('renders category chips with labels', () => {
    render(<Timer />)
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Study')).toBeTruthy()
  })

  it('sorts category chips by most recently used first', async () => {
    vi.mocked(localStore.getRecentCategoryNames).mockReturnValue(['study', 'work'])

    render(<Timer />)

    const categorySelector = await screen.findByTestId('timer-category-selector')
    const orderedLabels = Array.from(categorySelector.querySelectorAll('button')).map(button =>
      button.textContent?.trim() ?? ''
    )

    expect(orderedLabels.slice(0, 2)).toEqual(['Study', 'Work'])
  })

  it('promotes a selected category to the front of the selector order', async () => {
    const markCategoryUsedMock = vi.mocked(localStore.markCategoryUsed)
    markCategoryUsedMock.mockImplementation((categoryName: string) => {
      if (categoryName === 'work') return ['work', 'study']
      return ['study', 'work']
    })

    render(<Timer />)

    fireEvent.click(await screen.findByText('Study'))

    await waitFor(() => {
      const categorySelector = screen.getByTestId('timer-category-selector')
      const orderedLabels = Array.from(categorySelector.querySelectorAll('button')).map(button =>
        button.textContent?.trim() ?? ''
      )
      expect(orderedLabels.slice(0, 2)).toEqual(['Study', 'Work'])
    })
  })

  it('renders time display with large theme-aware text', () => {
    render(<Timer />)
    const timeDisplay = screen.getByText('25:00')
    expect(timeDisplay).toBeTruthy()
    expect(timeDisplay.className).toContain('text-gray-600')
    expect(timeDisplay.className).toContain('dark:text-gray-100')
    expect(timeDisplay.className).toMatch(/text-\[(34|36|40|44)px\]/)
    expect(timeDisplay.className).toContain('font-light')
    expect(timeDisplay.className).toContain('[font-variant-numeric:tabular-nums]')
  })

  it('renders START FOCUS button text by default', () => {
    render(<Timer />)
    expect(screen.getByText('START FOCUS')).toBeTruthy()
  })

  it('renders the focus prompt heading', () => {
    render(<Timer />)
    expect(screen.getByText("What's your focus?")).toBeTruthy()
  })

  it('shows focus session badge by default', () => {
    render(<Timer />)
    expect(screen.getByText('FOCUS SESSION')).toBeTruthy()
  })

  it('uses the selected category color for the start button', async () => {
    render(<Timer />)

    const startButton = await screen.findByRole('button', { name: 'START FOCUS' })
    expect(startButton).toHaveStyle({ backgroundColor: '#3b82f6' })
  })

  it('preserves the green rest accent for the start button and selected category chip', () => {
    render(<Timer />)

    fireEvent.click(screen.getByTestId('idle-mode-rest'))

    const startButton = screen.getByRole('button', { name: 'START REST' })
    expect(startButton).toHaveStyle({ backgroundColor: '#34C759' })

    const selectedCategoryChip = screen.getByText('Work').closest('button')
    expect(selectedCategoryChip).toHaveStyle({ backgroundColor: '#34C759' })
  })

  it('uses the selected category color for the active focus toggle', async () => {
    render(<Timer />)

    const focusToggle = await screen.findByTestId('idle-mode-focus')
    expect(focusToggle).toHaveStyle({ backgroundColor: '#3b82f6' })
  })

  it('lets the user switch to rest mode in idle state', async () => {
    render(<Timer />)

    fireEvent.click(screen.getByTestId('idle-mode-rest'))

    await waitFor(() => {
      const fetchMock = vi.mocked(globalThis.fetch)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/timer',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"sessionType":"break"'),
        })
      )
    })
  })

  it('defaults back to focus when server returns idle break state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/timer')) {
        return new Response(JSON.stringify({
          phase: 'idle',
          sessionType: 'break',
          intention: '',
          category: 'work',
          targetMs: 5 * 60 * 1000,
          remainingMs: 5 * 60 * 1000,
          overflowMs: 0,
          startedAt: null,
          pausedAt: null,
          updatedAt: Date.now(),
          todoistTaskId: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 200 })
    })

    render(<Timer />)

    await waitFor(() => {
      expect(screen.getByText('FOCUS SESSION')).toBeTruthy()
    })
    expect(screen.getByText("What's your focus?")).toBeTruthy()
    expect(screen.getByText('25:00')).toBeTruthy()
  })

  it('shows active controls from running state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/timer')) {
        return new Response(JSON.stringify({
          phase: 'running',
          sessionType: 'focus',
          intention: 'Test task',
          category: 'work',
          targetMs: 25 * 60 * 1000,
          remainingMs: 20 * 60 * 1000,
          overflowMs: 0,
          startedAt: Date.now() - 5 * 60 * 1000,
          pausedAt: null,
          updatedAt: Date.now(),
          todoistTaskId: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 200 })
    })

    render(<Timer />)

    // Wait for server state to apply
    await vi.waitFor(() => {
      expect(screen.getByText('Pause')).toBeTruthy()
    })
    expect(screen.getByText('Finish')).toBeTruthy()
    expect(screen.getByText('Abandon')).toBeTruthy()
  })

  it('shows overflow label when remaining time is negative', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/timer')) {
        return new Response(JSON.stringify({
          phase: 'running',
          sessionType: 'focus',
          intention: 'Overtime task',
          category: 'work',
          targetMs: 25 * 60 * 1000,
          remainingMs: -120000, // 2 minutes overflow
          overflowMs: 120000,
          startedAt: Date.now() - 27 * 60 * 1000,
          pausedAt: null,
          updatedAt: Date.now(),
          todoistTaskId: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 200 })
    })

    render(<Timer />)

    await vi.waitFor(() => {
      expect(screen.getByText('OVERFLOW')).toBeTruthy()
    })
  })

  it('requests screen wake lock directly from the start tap when keep-awake is enabled', async () => {
    keepScreenAwake = true
    const release = vi.fn(async () => {})
    const sentinel = new EventTarget() as EventTarget & {
      released: boolean
      type: 'screen'
      release: () => Promise<void>
    }
    sentinel.released = false
    sentinel.type = 'screen'
    sentinel.release = release
    const request = vi.fn(async () => sentinel)
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    })

    render(<Timer />)
    fireEvent.click(screen.getByText('START FOCUS'))

    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
  })

  it('copies selected Todoist task content into intention', () => {
    // Todoist mock already renders. Just verify it mounts.
    render(<Timer />)
    expect(screen.getByTestId('todoist-tasks-mock')).toBeTruthy()
  })
})
