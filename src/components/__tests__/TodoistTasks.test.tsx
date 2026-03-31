import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TodoistTasks from '../TodoistTasks'

const mockTasks = [
  { id: 't1', content: 'Write unit tests', duration: { amount: 25, unit: 'minute' }, labels: [], priority: 1 },
  { id: 't2', content: 'Review PR', duration: null, labels: [], priority: 4 },
  { id: 't3', content: 'Deploy to staging', duration: { amount: 15, unit: 'minute' }, labels: [], priority: 3 },
]

beforeEach(() => {
  vi.restoreAllMocks()
})

function mockFetchConfiguredWithTasks() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/api/todoist/status')) {
      return new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/api/todoist/tasks') && !url.includes('/close')) {
      return new Response(JSON.stringify({ tasks: mockTasks }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200 })
  })
}

function mockFetchNotConfigured() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(JSON.stringify({ configured: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

describe('TodoistTasks', () => {
  it('renders nothing when not configured', async () => {
    mockFetchNotConfigured()
    const { container } = render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )
    await waitFor(() => {
      expect(container.innerHTML).toBe('')
    })
  })

  it('renders trigger with placeholder text when configured with tasks', async () => {
    mockFetchConfiguredWithTasks()
    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )

    // Wait for tasks to load and the "Select a task..." placeholder to appear
    const trigger = await screen.findByText('Select a task...')
    expect(trigger).toBeTruthy()
  })

  it('shows selected task content in trigger', async () => {
    mockFetchConfiguredWithTasks()
    const { container } = render(
      <TodoistTasks selectedTaskId="t1" onSelectTask={vi.fn()} />
    )

    // Wait for tasks to load - the selected task content appears in the trigger ListItem
    await waitFor(() => {
      expect(container.textContent).toContain('Write unit tests')
    })
  })

  it('opens sheet and shows task list when trigger is clicked', async () => {
    mockFetchConfiguredWithTasks()
    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )

    // Wait for tasks to load
    const trigger = await screen.findByText('Select a task...')

    // Click the list item to open the sheet
    const listItem = trigger.closest('[class*="list-item"]') || trigger.closest('li') || trigger
    fireEvent.click(listItem)

    // Tasks should now be visible in the sheet
    // The sheet renders task items - look for the sheet toolbar title
    await waitFor(() => {
      expect(screen.getByText('Tasks')).toBeTruthy()
    })
  })

  it('renders priority badges for high-priority tasks', async () => {
    mockFetchConfiguredWithTasks()
    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )

    const trigger = await screen.findByText('Select a task...')
    const listItem = trigger.closest('[class*="list-item"]') || trigger.closest('li') || trigger
    fireEvent.click(listItem)

    // Task t2 has priority 4 -> P1
    await waitFor(() => {
      expect(screen.getByText('P1')).toBeTruthy()
    })
    // Task t3 has priority 3 -> P2
    expect(screen.getByText('P2')).toBeTruthy()
  })

  it('calls onSelectTask when a task is clicked in the sheet', async () => {
    mockFetchConfiguredWithTasks()
    const onSelectTask = vi.fn()
    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={onSelectTask} />
    )

    const trigger = await screen.findByText('Select a task...')
    const listItem = trigger.closest('[class*="list-item"]') || trigger.closest('li') || trigger
    fireEvent.click(listItem)

    await waitFor(() => {
      expect(screen.getByText('Write unit tests')).toBeTruthy()
    })

    // Click on the first task in the sheet
    const taskElements = screen.getAllByText('Write unit tests')
    // The second occurrence is in the sheet (first is the trigger if selected)
    const sheetTask = taskElements[taskElements.length - 1]
    const taskListItem = sheetTask.closest('li') || sheetTask.closest('[class*="list-item"]') || sheetTask
    fireEvent.click(taskListItem)

    expect(onSelectTask).toHaveBeenCalledWith(mockTasks[0])
  })
})
