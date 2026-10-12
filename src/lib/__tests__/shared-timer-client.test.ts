import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SharedTimerQueue } from '../shared-timer-client'
const baseline = { phase: 'running', updatedAt: 100, startedAt: 50 }
const body = { phase: 'paused', startedAt: 50, remainingMs: 9000 }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
describe('durable shared timer client', () => {
  it('captures baseline at action creation and chains queued actions in order', async () => {
    let release!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      .mockResolvedValue(response({ ...baseline, updatedAt: 102 }))
    const queue = new SharedTimerQueue()
    queue.accept(baseline)
    const first = queue.enqueue(body)
    const second = queue.enqueue({ ...body, phase: 'running' })
    queue.accept({ updatedAt: 500, startedAt: 400 }) // Must not replace a pending action baseline.
    await Promise.resolve()
    release(response({ ...baseline, updatedAt: 101 }))
    await Promise.all([first, second])
    const sent = fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)))
    expect(sent[0]).toMatchObject({ expectedUpdatedAt: 100, expectedStartedAt: 50 })
    expect(sent[1].afterTimerOpId).toBe(sent[0].opId)
    expect(sent[1].deviceId).toBe(sent[0].deviceId)
    expect(queue.hasPending).toBe(false)
    expect(queue.precondition()).toEqual({ expectedUpdatedAt: 102, expectedStartedAt: 50 })
  })
  it('keeps exact command identity/timestamp across offline reload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('disconnected'))
    const first = new SharedTimerQueue()
    first.accept(baseline)
    await first.enqueue(body)
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const restored = new SharedTimerQueue()
    const onNotice = vi.fn()
    restored.onNotice = onNotice
    expect(restored.hasPending).toBe(true)
    fetchMock.mockResolvedValue(response({ ...baseline, updatedAt: 101 }))
    await restored.flush()
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(sent)
    expect(restored.hasPending).toBe(false)
    expect(onNotice).toHaveBeenLastCalledWith(null)
  })
  it('retries a lost HTTP response with the same op and accepts the server winner', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValue(response({ ...baseline, updatedAt: 101, result: { status: 'duplicate' } }))
    const queue = new SharedTimerQueue()
    queue.accept(baseline)
    await queue.enqueue(body)
    await queue.flush()
    expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body)
    expect(queue.precondition().expectedUpdatedAt).toBe(101)
  })
  it('conflict removes dependent writes and displays the winning snapshot once', async () => {
    let release!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { release = resolve }))
    const queue = new SharedTimerQueue()
    queue.accept(baseline)
    const onConflict = vi.fn(), onSnapshot = vi.fn(), onNotice = vi.fn()
    queue.onConflict = onConflict; queue.onSnapshot = onSnapshot; queue.onNotice = onNotice
    const first = queue.enqueue(body)
    queue.enqueue({ ...body, phase: 'running' })
    const winner = { phase: 'running', updatedAt: 500, startedAt: 400 }
    await Promise.resolve()
    release(response({ timerConflict: true, timer: winner }, 409))
    await first
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(queue.hasPending).toBe(false)
    expect(onConflict).toHaveBeenCalledTimes(1)
    expect(onSnapshot).toHaveBeenCalledWith(winner, false)
    expect(onNotice).toHaveBeenLastCalledWith(expect.stringContaining('Session changed'))
    expect(new SharedTimerQueue().hasPending).toBe(false)
  })
  it('uses one flush while reachability callbacks fire repeatedly', async () => {
    let release!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { release = resolve }))
    const queue = new SharedTimerQueue()
    const first = queue.enqueue(body)
    const second = queue.flush()
    expect(first).toBe(second)
    await Promise.resolve()
    release(response(baseline))
    await first
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('unchanged and out-of-order poll snapshots cannot overwrite local edits or roll back the timer', () => {
    const queue = new SharedTimerQueue()
    const callback = vi.fn()
    queue.onSnapshot = callback
    queue.accept({ ...baseline, updatedAt: 12 })
    queue.accept({ ...baseline, updatedAt: 12 })
    queue.accept({ ...baseline, updatedAt: 11 })
    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ updatedAt: 12 }), true)
    expect(queue.precondition().expectedUpdatedAt).toBe(12)
  })
  it('independent tabs cannot overwrite each others durable queue', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const editing = new SharedTimerQueue(localStorage, 'tab-one')
    editing.accept(baseline)
    await editing.enqueue(body)
    const idle = new SharedTimerQueue(localStorage, 'tab-two')
    idle.accept({ updatedAt: 500, startedAt: 400 })
    expect(new SharedTimerQueue(localStorage, 'tab-one').hasPending).toBe(true)
    expect(new SharedTimerQueue(localStorage, 'tab-two').hasPending).toBe(false)
  })
  it('a rejected transaction receipt is not acknowledged as success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...baseline, result: { status: 'rejected' } }))
    const queue = new SharedTimerQueue()
    await queue.enqueue(body)
    expect(queue.hasPending).toBe(true)
  })
  it('duplicated tab scope is claimed by one document; the clone gets a separate durable queue', async () => {
    const occupied = new Set<string>()
    const locks = { request: (name: string, _options: unknown, callback: (lock: Lock | null) => unknown) => {
      const lock = occupied.has(name) ? null : { name, mode: 'exclusive' } as Lock
      if (lock) occupied.add(name)
      return Promise.resolve(callback(lock))
    } } as unknown as Pick<LockManager, 'request'>
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const original = new SharedTimerQueue(localStorage, 'cloned-scope', locks)
    await original.enqueue(body)
    const clone = new SharedTimerQueue(localStorage, 'cloned-scope', locks)
    await clone.enqueue({ ...body, phase: 'running' })
    const durableKeys = Object.keys(localStorage).filter(key => key.startsWith('sesh:sharedTimerQueue:v2:'))
    expect(durableKeys).toHaveLength(2)
    const queues = durableKeys.map(key => JSON.parse(localStorage.getItem(key)!))
    expect(queues.map(queue => queue.pending.length).sort()).toEqual([1, 2])
    expect(queues[0].pending[0].opId).toBe(queues[1].pending[0].opId) // replay, not duplicate side effects
    const descendant = new SharedTimerQueue(localStorage, sessionStorage.getItem('sesh:sharedTimerQueue:v2:tab')!, locks)
    await descendant.enqueue({ ...body, phase: 'paused' })
    const allKeys = Object.keys(localStorage).filter(key => key.startsWith('sesh:sharedTimerQueue:v2:'))
    expect(allKeys).toHaveLength(3)
    expect(allKeys.map(key => JSON.parse(localStorage.getItem(key)!).pending.length).sort()).toEqual([1, 2, 3])
  })
  it('HTTP 500 keeps the durable queue for retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: 'unavailable' }, 500))
    const queue = new SharedTimerQueue()
    await queue.enqueue(body)
    expect(new SharedTimerQueue().hasPending).toBe(true)
  })
})
