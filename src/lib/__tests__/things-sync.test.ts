import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('server-only', () => ({}))

const db = new Database(':memory:')

db.exec(`
  CREATE TABLE things_tasks (
    uuid TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL DEFAULT 0,
    schedule INTEGER NOT NULL DEFAULT 0,
    scheduled_at INTEGER,
    deadline_at INTEGER,
    type INTEGER NOT NULL DEFAULT 0,
    in_trash INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    area_uuid TEXT,
    project_uuid TEXT
  );
  CREATE TABLE things_areas (uuid TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE things_tags (uuid TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE things_task_tags (task_uuid TEXT NOT NULL, tag_uuid TEXT NOT NULL, PRIMARY KEY (task_uuid, tag_uuid));
  CREATE TABLE things_sync (id INTEGER PRIMARY KEY CHECK (id = 1), history_key TEXT NOT NULL DEFAULT '', server_index INTEGER NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL DEFAULT 0);
  INSERT OR IGNORE INTO things_sync (id) VALUES (1);
`)

vi.mock('../server-db', () => ({ getDb: () => db }))

const fetchItems = vi.fn()
vi.mock('../things-cloud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../things-cloud')>()),
  fetchItems: (...args: unknown[]) => fetchItems(...args),
}))

import { syncThings, thingsSyncState } from '../things-store'

const creds = { email: 'a@b.c', password: 'secret' }

/** A page of `count` distinct tasks, as the event log would hand them over. */
function page(startIndex: number, count: number, total: number) {
  return {
    items: Array.from({ length: count }, (_, i) => ({
      uuid: `t${startIndex + i}`,
      kind: 'Task6',
      action: 0,
      payload: { tt: `Task ${startIndex + i}`, st: 1, tp: 0, ss: 0 },
    })),
    currentItemIndex: total,
  }
}

beforeEach(() => {
  fetchItems.mockReset()
  db.exec('DELETE FROM things_tasks')
  db.prepare('UPDATE things_sync SET history_key = ?, server_index = 0, synced_at = 0 WHERE id = 1').run('')
})

describe('bounding how long one sync runs', () => {
  it('reads the whole stream when it fits', async () => {
    fetchItems
      .mockResolvedValueOnce(page(0, 50, 100))
      .mockResolvedValueOnce(page(50, 50, 100))

    const outcome = await syncThings(creds, 'hk', { budgetMs: 10_000 })

    expect(outcome).toMatchObject({ fetched: 100, serverIndex: 100, caughtUp: true })
    expect(db.prepare('SELECT count(*) AS n FROM things_tasks').get()).toEqual({ n: 100 })
  })

  /**
   * The 502 this guards against: a first sync of a long history ran until it
   * was done, which is minutes, and the proxy gave up on the origin long
   * before that. It now stops at the budget and says it is not finished.
   */
  it('stops at the budget and reports that there is more', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    fetchItems.mockImplementation(async (_c: unknown, _k: unknown, start: number) => {
      now += 5_000
      return page(start, 10, 1_000)
    })

    const outcome = await syncThings(creds, 'hk', { budgetMs: 8_000 })

    expect(outcome.caughtUp).toBe(false)
    expect(fetchItems).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it('resumes from where the last one stopped rather than replaying', async () => {
    fetchItems.mockResolvedValueOnce(page(0, 10, 30))
    await syncThings(creds, 'hk', { maxBatches: 1 })
    expect(thingsSyncState().serverIndex).toBe(10)

    fetchItems.mockResolvedValueOnce(page(10, 20, 30))
    await syncThings(creds, 'hk', { maxBatches: 1 })

    expect(fetchItems.mock.calls[1][2]).toBe(10)
    expect(thingsSyncState()).toMatchObject({ serverIndex: 30, historyKey: 'hk' })
    expect(db.prepare('SELECT count(*) AS n FROM things_tasks').get()).toEqual({ n: 30 })
  })

  it('starts over when the account behind the stream changes', async () => {
    fetchItems.mockResolvedValueOnce(page(0, 5, 5))
    await syncThings(creds, 'hk', {})
    expect(db.prepare('SELECT count(*) AS n FROM things_tasks').get()).toEqual({ n: 5 })

    fetchItems.mockResolvedValueOnce({ items: [], currentItemIndex: 0 })
    await syncThings(creds, 'other-key', {})

    expect(db.prepare('SELECT count(*) AS n FROM things_tasks').get()).toEqual({ n: 0 })
    expect(fetchItems.mock.calls[1][2]).toBe(0)
  })
})
