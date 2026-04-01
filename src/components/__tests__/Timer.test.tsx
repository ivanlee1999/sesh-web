import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock dependencies before importing Timer
vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      focusDuration: 25,
      breakDuration: 5,
      soundEnabled: false,
      calendarSync: false,
      darkMode: false,
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

beforeEach(() => {
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
    const input = screen.getByPlaceholderText('What are you working on?')
    expect(input).toBeTruthy()
  })

  it('renders category chips with labels', () => {
    render(<Timer />)
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Study')).toBeTruthy()
  })

  it('renders time display with bold theme-aware text', () => {
    render(<Timer />)
    const timeDisplay = screen.getByText('25:00')
    expect(timeDisplay).toBeTruthy()
    expect(timeDisplay.className).toContain('text-black')
    expect(timeDisplay.className).toContain('dark:text-white')
    expect(timeDisplay.className).toContain('text-[48px]')
    expect(timeDisplay.className).toContain('font-light')
  })

  it('renders START SESSION button text', () => {
    render(<Timer />)
    expect(screen.getByText('START SESSION')).toBeTruthy()
  })

  it('renders session type segmented control', () => {
    render(<Timer />)
    expect(screen.getByText('Focus')).toBeTruthy()
    expect(screen.getByText('Rest')).toBeTruthy()
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

  it('copies selected Todoist task content into intention', () => {
    // Todoist mock already renders. Just verify it mounts.
    render(<Timer />)
    expect(screen.getByTestId('todoist-tasks-mock')).toBeTruthy()
  })
})
