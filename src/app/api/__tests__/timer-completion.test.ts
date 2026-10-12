import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { makeTestDb } from '@/lib/__tests__/test-db'

vi.mock('server-only', () => ({}))
let db: Database.Database
vi.mock('@/lib/server-db', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/server-db')>()
  return { ...original, getDb: () => db }
})
const effects = vi.fn<(session: unknown, options: unknown) => Promise<Record<string, never>>>(async () => ({}))
vi.mock('@/lib/session-complete', () => ({ runCompletionSideEffects: (session: unknown, options: unknown) => effects(session, options) }))
vi.mock('@/lib/timer-notifications', () => ({
  stopTimerNotificationScheduler: vi.fn(),
  rowToTimerJson: (row: unknown) => row,
}))
import { POST } from '../timer/route'
const startedAt = 1700000000000
const request = (extra: Record<string, unknown> = {}) => new Request('http://localhost/api/timer', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startedAt, ...extra }),
})
beforeEach(() => {
  db = makeTestDb()
  effects.mockClear()
  db.prepare("UPDATE timer_state SET phase = 'paused', started_at = ?, paused_at = ?, target_ms = 1500000, remaining_ms = 900000, todoist_task_id = 'old', category = 'other'").run(startedAt, startedAt + 600000)
})
afterEach(() => db.close())
describe('atomic reflection completion', () => {
  it('persists notes and final task selection without counting review time', async () => {
    const response = await POST(request({ notes: 'Parser done; tests next', todoistTaskId: 'new', intention: 'Parser' }))
    expect(response.status).toBe(200)
    const row = db.prepare('SELECT * FROM sessions').get() as Record<string, unknown>
    expect(row).toMatchObject({ notes: 'Parser done; tests next', todoist_task_id: 'new', actual_ms: 600000, ended_at: startedAt + 600000 })
    expect(effects).toHaveBeenCalledWith(expect.objectContaining({ todoistTaskId: 'new' }), { isNew: true })
    expect((db.prepare('SELECT phase FROM timer_state').get() as { phase: string }).phase).toBe('idle')
  })
  it('repeated submission creates one session and one set of side effects', async () => {
    await POST(request({ todoistTaskId: null }))
    expect(await (await POST(request())).json()).toEqual({ completed: false })
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 })
    expect(effects).toHaveBeenCalledTimes(1)
  })
})
