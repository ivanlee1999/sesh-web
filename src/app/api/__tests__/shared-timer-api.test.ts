import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { makeTestDb } from '@/lib/__tests__/test-db'
import { rowToTimerJson } from '@/lib/timer-notification-logic'
vi.mock('server-only', () => ({}))
let db: Database.Database
vi.mock('@/lib/server-db', async original => ({ ...await original<typeof import('@/lib/server-db')>(), getDb: () => db }))
vi.mock('@/lib/session-complete', () => ({ runCompletionSideEffects: vi.fn(async () => ({})) }))
vi.mock('@/lib/google-calendar', () => ({ deleteSessionCalendarEvent: vi.fn() }))
vi.mock('@/lib/timer-notifications', () => ({
  rowToTimerJson: (row: Parameters<typeof rowToTimerJson>[0]) => rowToTimerJson(row),
  ensureTimerNotificationScheduler: vi.fn(), stopTimerNotificationScheduler: vi.fn(),
  shouldTimerNotificationSchedulerRun: () => false,
  checkAndSendOverflowNotifications: async () => ({ row: db.prepare('SELECT * FROM timer_state').get() }),
}))
import { GET, POST, PUT } from '../timer/route'
import { POST as SYNC } from '../sync/route'
const now = 1_800_000_000_000
const request = (method: string, body: unknown) => new Request('http://fixture/api/timer', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
function start(extra: Record<string, unknown> = {}) {
  return { opId: 'start', deviceId: 'web', phase: 'running', sessionType: 'focus', intention: 'Fixture', category: 'other',
    targetMs: 60_000, remainingMs: 60_000, overflowMs: 0, startedAt: now, pausedAt: null,
    expectedUpdatedAt: 0, expectedStartedAt: null, recordedAt: now, ...extra }
}
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); db = makeTestDb() })
afterEach(() => { db.close(); vi.restoreAllMocks() })
describe('shared timer HTTP contract', () => {
  it('advertises guarded timer capabilities without changing the idle row', async () => {
    expect(await (await GET()).json()).toMatchObject({ phase: 'idle', timerProtocolVersion: 2, updatedAt: 0 })
    expect(await (await SYNC(request('POST', { ops: [] }))).json()).toMatchObject({ timerProtocolVersion: 2, timer: { phase: 'idle' } })
  })
  it('PUT repeats successful receipts without changing the version', async () => {
    const first = await (await PUT(request('PUT', start()))).json()
    const retry = await (await PUT(request('PUT', start()))).json()
    expect(retry.updatedAt).toBe(first.updatedAt)
    expect(retry.result).toMatchObject({ status: 'duplicate', timerUpdatedAt: first.updatedAt })
  })
  it('PUT returns 409 plus the winning timer for stale writes and their replay', async () => {
    await PUT(request('PUT', start()))
    const stale = start({ opId: 'other', startedAt: now + 1 })
    for (let i = 0; i < 2; i++) {
      const result = await PUT(request('PUT', stale))
      expect(result.status).toBe(409)
      expect(await result.json()).toMatchObject({ timerConflict: true, timer: { startedAt: now } })
    }
  })
  it('PUT malformed guarded timings return 400 without a write', async () => {
    expect((await PUT(request('PUT', start({ expectedUpdatedAt: '0' })))).status).toBe(400)
    expect(await (await GET()).json()).toMatchObject({ updatedAt: 0 })
  })
  it('guarded reflection completion cannot stop a timer changed since reflection began', async () => {
    const first = await (await PUT(request('PUT', start()))).json()
    await PUT(request('PUT', start({ opId: 'pause', afterTimerOpId: 'start', phase: 'paused', pausedAt: now })))
    const completion = await POST(request('POST', { startedAt: now, expectedUpdatedAt: first.updatedAt, expectedStartedAt: now }))
    expect(completion.status).toBe(409)
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
    expect(await (await GET()).json()).toMatchObject({ phase: 'paused', startedAt: now })
  })
})
