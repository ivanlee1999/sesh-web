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

  it('renders dropdown trigger with proper Tailwind classes when configured with tasks', async () => {
    mockFetchConfiguredWithTasks()
    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )

    // Wait for tasks to load and the "Select a task..." placeholder to appear
    const trigger = await screen.findByText('Select a task...')
    expect(trigger).toBeTruthy()

    // The trigger span should use Tailwind text classes
    expect(trigger.className).toContain('text-gray-500')
    expect(trigger.className).toContain('text-[15px]')
    expect(trigger.className).toContain('truncate')

    // The trigger button (parent) should have Tailwind border/bg classes
    const button = trigger.closest('button')!
    expect(button.className).toContain('rounded-xl')
    expect(button.className).toContain('border-gray-300')
    expect(button.className).toContain('bg-white')
    expect(button.className).toContain('min-h-[44px]')
  })

  it('shows selected task with text-black and blue styling', async () => {
    mockFetchConfiguredWithTasks()
    render(
      <TodoistTasks selectedTaskId="t1" onSelectTask={vi.fn()} />
    )

    const taskText = await screen.findByText('Write unit tests')
    expect(taskText).toBeTruthy()

    // When a task is selected, the text span uses text-black
    expect(taskText.className).toContain('text-black')

    // The trigger button should have selected styling (blue border, blue bg)
    const button = taskText.closest('button')!
    expect(button.className).toContain('border-blue-500')
    expect(button.className).toContain('bg-blue-50')
  })

  it('renders task items with Tailwind text classes when dropdown is open', async () => {
    mockFetchConfiguredWithTasks()
    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )

    // Wait for tasks to load
    const trigger = await screen.findByText('Select a task...')

    // Open the dropdown
    fireEvent.click(trigger.closest('button')!)

    // Task items should now be visible with proper text classes
    const taskItem = await screen.findByText('Write unit tests')
    expect(taskItem).toBeTruthy()

    // Task content should use text-black
    const taskParagraph = taskItem.closest('p')!
    expect(taskParagraph.className).toContain('text-black')
    expect(taskParagraph.className).toContain('text-[15px]')

    // Duration text should use Tailwind color
    const durationSpan = screen.getByText('25min')
    expect(durationSpan.className).toContain('text-gray-500')
    expect(durationSpan.className).toContain('text-xs')
  })

  it('renders priority labels with Tailwind color classes', async () => {
    mockFetchConfiguredWithTasks()

    render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )

    const trigger = await screen.findByText('Select a task...')
    fireEvent.click(trigger.closest('button')!)

    // Task t2 has priority 4 -> P1 -> text-red-500
    const p1Label = await screen.findByText('P1')
    expect(p1Label.className).toContain('text-red-500')
    expect(p1Label.className).toContain('text-xs')

    // Task t3 has priority 3 -> P2 -> text-orange-500
    const p2Label = screen.getByText('P2')
    expect(p2Label.className).toContain('text-orange-500')
  })

  it('renders the dropdown container with proper Tailwind classes', async () => {
    mockFetchConfiguredWithTasks()

    const { container } = render(
      <TodoistTasks selectedTaskId={null} onSelectTask={vi.fn()} />
    )

    const trigger = await screen.findByText('Select a task...')
    fireEvent.click(trigger.closest('button')!)

    // Wait for dropdown menu to render
    await screen.findByText('Write unit tests')

    // The dropdown menu should have Tailwind border/bg/shadow classes
    // Find the dropdown container (it has rounded-xl, border, bg-white, shadow-md)
    const dropdownMenu = container.querySelector('.rounded-xl.border.border-gray-200.bg-white.shadow-md')
    expect(dropdownMenu).toBeTruthy()
  })
})
