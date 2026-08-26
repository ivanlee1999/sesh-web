import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_FOCUS_TIME_ATTEMPTS,
  enqueueFocusTime,
  getFocusTimeQueue,
  markFocusTimeAttempt,
  removeQueuedFocusTime,
} from '@/lib/local-store'
import { flushFocusTimeQueue } from '@/lib/task-sources'

function queue(...refs: string[]) {
  for (const taskRef of refs) enqueueFocusTime({ taskRef, minutes: 26, queuedAt: 1_700_000_000_000 })
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('focus-time queue', () => {
  it('keeps what was queued, in order, unattempted', () => {
    queue('t1', 'things:A1')
    expect(getFocusTimeQueue()).toEqual([
      { taskRef: 't1', minutes: 26, queuedAt: 1_700_000_000_000, attempts: 0 },
      { taskRef: 'things:A1', minutes: 26, queuedAt: 1_700_000_000_000, attempts: 0 },
    ])
  })

  it('drops an entry once it has failed enough times', () => {
    queue('t1')
    for (let i = 0; i < MAX_FOCUS_TIME_ATTEMPTS - 1; i++) markFocusTimeAttempt(0)
    expect(getFocusTimeQueue()).toHaveLength(1)
    markFocusTimeAttempt(0)
    expect(getFocusTimeQueue()).toHaveLength(0)
  })

  it('survives a corrupt payload rather than throwing', () => {
    localStorage.setItem('sesh:focusTimeQueue', '{not json')
    expect(getFocusTimeQueue()).toEqual([])
    removeQueuedFocusTime(0)
  })
})

describe('flushFocusTimeQueue', () => {
  it('replays each entry to its own provider and empties the queue', async () => {
    queue('t1', 'things:A1')
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await flushFocusTimeQueue()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/todoist/tasks/t1/duration',
      '/api/things/tasks/A1/duration',
    ])
    expect(getFocusTimeQueue()).toEqual([])
  })

  it('sends the minutes that were queued', async () => {
    enqueueFocusTime({ taskRef: 't1', minutes: 26.4, queuedAt: 0 })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await flushFocusTimeQueue()

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ add_minutes: 26 })
  })

  it('keeps the entry and stops when the provider is unreachable', async () => {
    queue('t1', 'things:A1')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))

    await flushFocusTimeQueue()

    const remaining = getFocusTimeQueue()
    expect(remaining).toHaveLength(2)
    expect(remaining[0].attempts).toBe(1)
  })

  it('does not retry a task the provider has permanently rejected', async () => {
    queue('t1', 'things:A1')
    const fetchMock = vi.fn(async (url: string) =>
      new Response('', { status: url.includes('/t1/') ? 404 : 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await flushFocusTimeQueue()

    expect(getFocusTimeQueue()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('is a no-op on an empty queue', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await flushFocusTimeQueue()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
