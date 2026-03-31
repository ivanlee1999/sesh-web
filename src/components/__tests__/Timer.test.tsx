import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock dependencies before importing Timer
vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      focusDuration: 25,
      shortBreakDuration: 5,
      longBreakDuration: 20,
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
  it('renders the idle view with Tailwind classes and no CSS var inline styles for colors', () => {
    const { container } = render(<Timer />)

    // The outermost wrapper should use Tailwind classes
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.className).toContain('flex')
    expect(wrapper.className).toContain('flex-col')
    expect(wrapper.className).toContain('items-center')

    // The wrapper should NOT have CSS custom property inline styles for color
    const style = wrapper.getAttribute('style') || ''
    expect(style).not.toMatch(/--[\w-]+-color/)
  })

  it('renders the intention input with proper Tailwind classes for visibility', () => {
    render(<Timer />)

    const input = screen.getByPlaceholderText('What are you working on?')
    expect(input).toBeTruthy()

    // Should have text-black for visible text
    expect(input.className).toContain('text-black')
    // Should have text-[15px] for readable size
    expect(input.className).toContain('text-[15px]')
    // Should have border styling via Tailwind
    expect(input.className).toContain('border')
    expect(input.className).toContain('border-gray-300')
    // Should have bg-white for visible background
    expect(input.className).toContain('bg-white')
    // Should have rounded corners
    expect(input.className).toContain('rounded-xl')
  })

  it('renders category pills with border-based styling', () => {
    const { container } = render(<Timer />)

    // Find category pill buttons by their label text
    const workButton = screen.getByText('Work').closest('button')
    const studyButton = screen.getByText('Study').closest('button')

    expect(workButton).toBeTruthy()
    expect(studyButton).toBeTruthy()

    // Category pills should use border-2 Tailwind class for border-based styling
    expect(workButton!.className).toContain('border-2')
    expect(workButton!.className).toContain('rounded-full')
    expect(workButton!.className).toContain('font-medium')

    expect(studyButton!.className).toContain('border-2')
    expect(studyButton!.className).toContain('rounded-full')

    // The borderColor should come from the category color via inline style
    // (this is acceptable for dynamic values), but the structural styling is Tailwind
    expect(workButton!.style.borderColor).toBeTruthy()
    expect(studyButton!.style.borderColor).toBeTruthy()
  })

  it('renders time display with Tailwind text-black class', () => {
    const { container } = render(<Timer />)

    // Find the time display span: it should show "25:00" and use text-black
    const timeDisplay = screen.getByText('25:00')
    expect(timeDisplay).toBeTruthy()
    expect(timeDisplay.className).toContain('text-black')
    expect(timeDisplay.className).toContain('font-mono')
    expect(timeDisplay.className).toContain('text-4xl')
    expect(timeDisplay.className).toContain('font-semibold')
  })

  it('renders category dot indicators inside pills', () => {
    const { container } = render(<Timer />)

    // Each category pill has a small colored dot (span with rounded-full and h-[7px])
    const workButton = screen.getByText('Work').closest('button')!
    const dot = workButton.querySelector('span.rounded-full')
    expect(dot).toBeTruthy()
    expect(dot!.className).toContain('h-[7px]')
    expect(dot!.className).toContain('w-[7px]')
  })

  it('renders START SESSION button text', () => {
    render(<Timer />)
    expect(screen.getByText('START SESSION')).toBeTruthy()
  })
})
