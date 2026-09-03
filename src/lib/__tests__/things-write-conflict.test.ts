import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('server-only', () => ({}))

/**
 * Writing to Things Cloud when the stream has moved on.
 *
 * A commit carries `ancestor-index`, the writer's view of the server head, and
 * Things refuses anything that is not the head *right now* with a 409 — which
 * the API surfaced to the person as a 502 on every completion. These tests
 * stand up the protocol as the server actually behaves so the two ways of
 * being behind are both covered: a local index that was already stale, and a
 * head that moves between the sync and the commit.
 */

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

import { completeThings, createThings } from '../things-service'
import type { ResolvedThingsConfig } from '../things-config'

const HISTORY_KEY = 'test-history'
const CONFIG: ResolvedThingsConfig = {
  mode: 'cloud',
  credentials: { email: 'someone@example.com', password: 'secret' },
  historyKey: HISTORY_KEY,
}

/** The server's head, and what it has been asked to accept. */
let head = 0
let commits: number[] = []
/**
 * Another device writing in the gap between our sync and our commit: the head
 * moves once, after the position has already been read and believed.
 */
let driftBeforeNextCommit = false

function stubServer() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const target = new URL(url)

    if (target.pathname.endsWith('/commit')) {
      if (driftBeforeNextCommit) {
        driftBeforeNextCommit = false
        head += 1
      }
      const ancestor = Number(target.searchParams.get('ancestor-index'))
      commits.push(ancestor)
      if (ancestor !== head) {
        return new Response('conflict', { status: 409 })
      }
      head += 1
      return Response.json({ 'server-head-index': head })
    }

    // A history read: every entry the caller has not seen, and the head. An
    // empty page is how the protocol says "you are already at the head".
    const start = Number(target.searchParams.get('start-index'))
    const behind = Math.max(0, head - start)
    return Response.json({
      items: Array.from({ length: behind }, () => ({})),
      'current-item-index': head,
    })
  }))
}

beforeEach(() => {
  head = 0
  commits = []
  driftBeforeNextCommit = false
  vi.stubEnv('THINGS_CLOUD_ENDPOINT', 'https://things.test')
  db.exec("DELETE FROM things_tasks; UPDATE things_sync SET history_key = 'test-history', server_index = 0, synced_at = 0")
  stubServer()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('committing while the stream moves', () => {
  it('completes a to-do against a stale local index', async () => {
    // The state that produced the bug: a sync recent enough that the old code
    // skipped re-reading, while Things.app had written three more entries.
    head = 32
    db.prepare('UPDATE things_sync SET server_index = 29, synced_at = ? WHERE id = 1').run(Date.now())

    await expect(completeThings(CONFIG, 'Jk8UauyBRvVwQCf9HXCHMg')).resolves.toBeUndefined()
    expect(commits.at(-1)).toBe(32)
  })

  it('retries when the head moves between the sync and the commit', async () => {
    head = 10
    driftBeforeNextCommit = true

    await expect(completeThings(CONFIG, 'Jk8UauyBRvVwQCf9HXCHMg')).resolves.toBeUndefined()
    // Refused at 10 because another device made the head 11, then landed on 11.
    expect(commits).toEqual([10, 11])
  })

  it('creates a to-do against a stale local index', async () => {
    head = 7
    db.prepare('UPDATE things_sync SET server_index = 4, synced_at = ? WHERE id = 1').run(Date.now())

    await createThings(CONFIG, { title: 'Buy milk', when: 'today' }, 0)
    expect(commits.at(-1)).toBe(7)
  })

  it('gives up rather than hammering a stream it can never match', async () => {
    // A head that always moves is indistinguishable from a broken server, so
    // the write has to fail rather than retry forever.
    head = 5
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const target = new URL(url)
      if (target.pathname.endsWith('/commit')) {
        commits.push(Number(target.searchParams.get('ancestor-index')))
        return new Response('conflict', { status: 409 })
      }
      return Response.json({ items: [], 'current-item-index': head })
    }))

    await expect(completeThings(CONFIG, 'Jk8UauyBRvVwQCf9HXCHMg')).rejects.toThrow(/409/)
    expect(commits).toHaveLength(3)
  })
})
