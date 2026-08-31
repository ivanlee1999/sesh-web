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
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    seen.push(url)
    if (url.includes('/api/things/tasks') && init?.method === 'POST') return json({ ok: true })
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

describe('adding a to-do', () => {
  /** The one call that created something, with its parsed body. */
  function createCall() {
    const call = vi.mocked(globalThis.fetch).mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      return url.includes('/api/things/tasks') && init?.method === 'POST'
    })
    return call ? { url: String(call[0]), body: JSON.parse(String(call[1]?.body)) } : null
  }

  it('files a to-do into Today while looking at Today, and reloads the list', async () => {
    mockProviders()
    render(<Tasks onFocusTask={vi.fn()} />)
    await screen.findByText('Draft the memo')

    const before = vi.mocked(globalThis.fetch).mock.calls.length
    fireEvent.change(await screen.findByPlaceholderText('Add to Today…'), {
      target: { value: 'Book the venue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add “Book the venue” to Today' }))

    await waitFor(() => expect(createCall()).toBeTruthy())
    expect(createCall()?.body).toEqual({ title: 'Book the venue', when: 'today' })

    // The list is re-read, so the new to-do shows without a manual refresh.
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(before + 1)
    })
  })

  it('files into the Inbox from any other list, rather than filling up Today', async () => {
    mockProviders()
    render(<Tasks onFocusTask={vi.fn()} />)
    await screen.findByText('Draft the memo')

    fireEvent.click(screen.getByRole('button', { name: /^All/ }))

    fireEvent.change(await screen.findByPlaceholderText('Add to Inbox…'), {
      target: { value: 'Someday idea' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add “Someday idea” to Inbox' }))

    await waitFor(() => expect(createCall()?.body).toEqual({ title: 'Someday idea', when: 'inbox' }))
  })

  it('says what went wrong and keeps the text, rather than losing it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/things/tasks') && init?.method === 'POST') {
        return json({ error: 'Things Cloud is not answering' }, 502)
      }
      if (url.includes('/api/things/status')) return json({ configured: true, reachable: true })
      if (url.includes('/api/things/tasks')) return json({ tasks: THINGS_TASKS })
      return json({ configured: false })
    })
    render(<Tasks onFocusTask={vi.fn()} />)
    await screen.findByText('Draft the memo')

    const field = await screen.findByPlaceholderText('Add to Today…') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Will not land' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add “Will not land” to Today' }))

    expect(await screen.findByText(/Things Cloud is not answering/)).toBeTruthy()
    expect(field.value).toBe('Will not land')
  })

  it('offers nothing to add when no provider accepts one', async () => {
    // Todoist only, and sesh does not create Todoist tasks.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/todoist/status')) return json({ configured: true })
      if (url.includes('/api/todoist/tasks')) return json({ tasks: [] })
      return json({ configured: false })
    })
    settings.todoistEnabled = true
    try {
      render(<Tasks onFocusTask={vi.fn()} />)
      await waitFor(() => expect(screen.queryByText('Checking Todoist...')).toBeNull())
      expect(screen.queryByPlaceholderText(/^Add to /)).toBeNull()
    } finally {
      settings.todoistEnabled = false
    }
  })
})
