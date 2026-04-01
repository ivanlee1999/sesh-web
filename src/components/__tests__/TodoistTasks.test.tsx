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

    const trigger = await screen.findByText('Select a task...')
    expect(trigger).toBeTruthy()
  })

  it('shows selected task content in trigger', async () => {
    mockFetchConfiguredWithTasks()
    const { container } = render(
      <TodoistTasks selectedTaskId="t1" onSelectTask={vi.fn()} />
    )

    await waitFor(() => {
      expect(container.textContent).toContain('Write unit tests')
    })
  })

  it('opens dropdown and shows task list when trigger is clicked', async () => {
    mockFetchConfiguredWithTasks()
    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )

    const trigger = await screen.findByText('Select a task...')
    fireEvent.click(trigger.closest('button')!)

    // Tasks should now be visible in the dropdown
    await waitFor(() => {
      expect(screen.getByText('Write unit tests')).toBeTruthy()
      expect(screen.getByText('Review PR')).toBeTruthy()
      expect(screen.getByText('Deploy to staging')).toBeTruthy()
    })
  })

  it('renders priority badges for high-priority tasks', async () => {
    mockFetchConfiguredWithTasks()
    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )

    const trigger = await screen.findByText('Select a task...')
    fireEvent.click(trigger.closest('button')!)

    await waitFor(() => {
      expect(screen.getByText('P1')).toBeTruthy()
    })
    expect(screen.getByText('P2')).toBeTruthy()
  })

  it('calls onSelectTask when a task is clicked in the dropdown', async () => {
    mockFetchConfiguredWithTasks()
    const onSelectTask = vi.fn()
    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={onSelectTask} />
    )

    const trigger = await screen.findByText('Select a task...')
    fireEvent.click(trigger.closest('button')!)

    await waitFor(() => {
      expect(screen.getByText('Write unit tests')).toBeTruthy()
    })

    // Click on the first task in the dropdown
    fireEvent.click(screen.getByText('Write unit tests').closest('[class*="cursor-pointer"]')!)

    expect(onSelectTask).toHaveBeenCalledWith(mockTasks[0])
  })
})
