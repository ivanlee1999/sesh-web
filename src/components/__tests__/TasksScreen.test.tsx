import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Tasks from '../Tasks'

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [
      { id: '1', name: 'work', label: 'Work', color: '#3b82f6', sortOrder: 0, isDefault: true },
    ],
    byName: {},
    loading: false,
    error: null,
    refresh: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  }),
}))

const settings = { todoistEnabled: false, todoistAutoComplete: true }

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({ settings, loaded: true, updateSettings: vi.fn() }),
}))

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const THINGS_TASKS = [
  { id: 'A1', provider: 'things', content: 'Draft the memo', duration: null, labels: [], priority: 4, projectName: 'Writing', due: 'today', dueLabel: 'Today' },
  { id: 'B2', provider: 'things', content: 'Reply to the RFP', duration: null, labels: [], priority: 4, projectName: 'Writing', due: 'today', dueLabel: 'Today' },
]

/** Records every URL asked for, so "never touched Todoist" is assertable. */
function mockProviders() {
  const seen: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = typeof input === 'string' ? input : (input as Request).url
    seen.push(url)
    if (url.includes('/api/things/status')) return json({ configured: true, reachable: true })
    if (url.includes('/api/things/tasks')) return json({ tasks: THINGS_TASKS })
    return json({ configured: false })
  })
  return seen
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('Tasks screen with Todoist switched off', () => {
  it('never calls Todoist and never names it on screen', async () => {
    const seen = mockProviders()

    render(<Tasks onFocusTask={vi.fn()} />)

    expect(await screen.findByText('Draft the memo')).toBeTruthy()
    expect(seen.some(url => url.includes('todoist'))).toBe(false)
    expect(screen.queryByText(/Todoist/i)).toBeNull()
  })
})

describe('Tasks screen refresh', () => {
  it('re-fetches the list from an explicit refresh control', async () => {
    const seen = mockProviders()

    render(<Tasks onFocusTask={vi.fn()} />)
    await screen.findByText('Draft the memo')

    const before = seen.filter(url => url.includes('/api/things/tasks')).length
    fireEvent.click(screen.getByLabelText('Refresh tasks'))

    await waitFor(() => {
      expect(seen.filter(url => url.includes('/api/things/tasks')).length).toBe(before + 1)
    })
  })
})

describe('Tasks screen multi-select', () => {
  it('hands the timer every selected task, not just the last one', async () => {
    mockProviders()
    const onFocusTask = vi.fn()

    render(<Tasks onFocusTask={onFocusTask} />)
    await screen.findByText('Draft the memo')

    fireEvent.click(screen.getByLabelText('Add Draft the memo to the session'))
    fireEvent.click(screen.getByLabelText('Add Reply to the RFP to the session'))

    expect(await screen.findByText('2 tasks selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }))

    expect(onFocusTask).toHaveBeenCalledWith({
      intention: 'Draft the memo · Reply to the RFP',
      category: 'work',
      taskIds: ['things:A1', 'things:B2'],
    })
  })

  it('drops a task from the selection when it is tapped again', async () => {
    mockProviders()
    const onFocusTask = vi.fn()

    render(<Tasks onFocusTask={onFocusTask} />)
    await screen.findByText('Draft the memo')

    fireEvent.click(screen.getByLabelText('Add Draft the memo to the session'))
    fireEvent.click(screen.getByLabelText('Remove Draft the memo from the session'))

    await waitFor(() => expect(screen.queryByText(/task[s]? selected/)).toBeNull())
  })

  it('still starts a one-task session straight from the row\'s focus button', async () => {
    mockProviders()
    const onFocusTask = vi.fn()

    render(<Tasks onFocusTask={onFocusTask} />)
    await screen.findByText('Draft the memo')

    fireEvent.click(screen.getByLabelText('Focus on Draft the memo'))

    expect(onFocusTask).toHaveBeenCalledWith({
      intention: 'Draft the memo',
      category: 'work',
      taskIds: ['things:A1'],
    })
  })
})
