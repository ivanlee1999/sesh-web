import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('server-only', () => ({}))

/**
 * The same real in-memory SQLite the store tests use. A created to-do is only
 * correct if this repo's own reader files it where the person asked, so the
 * payload is checked by round-tripping it through the replay rather than by
 * asserting field names back at themselves.
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

import { ACTION_CREATED, createdTaskFields, newTaskUuid } from '../things-cloud'
import { applyItems, readTasks } from '../things-store'

const TODAY = Math.floor(Date.UTC(2026, 7, 31) / 1000)

/** Commit a created to-do exactly as the service does, then replay it. */
function create(title: string, when: 'today' | 'anytime' | 'someday' | 'inbox') {
  const uuid = newTaskUuid()
  applyItems([{ uuid, kind: 'Task6', action: ACTION_CREATED, payload: createdTaskFields(title, when, TODAY) }])
  return uuid
}

beforeEach(() => {
  db.exec('DELETE FROM things_tasks; DELETE FROM things_task_tags;')
})

describe('creating a Things to-do', () => {
  it('mints a Base58 uuid Things will accept', () => {
    for (let i = 0; i < 200; i += 1) {
      const uuid = newTaskUuid()
      // The alphabet drops 0, O, I and l; the service rejects 20..32 outside.
      expect(uuid).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/)
      expect(uuid.length).toBeGreaterThanOrEqual(20)
      expect(uuid.length).toBeLessThanOrEqual(32)
    }
  })

  it('gives every uuid a distinct value', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newTaskUuid()))
    expect(seen.size).toBe(500)
  })

  it('files a to-do into Today, where the reader can find it', () => {
    const uuid = create('Ship the dial fix', 'today')

    const today = readTasks(['today'], TODAY)
    expect(today.map(t => t.uuid)).toContain(uuid)
    expect(today.find(t => t.uuid === uuid)?.title).toBe('Ship the dial fix')
    // Not double-counted into the loose piles.
    expect(readTasks(['inbox'], TODAY).map(t => t.uuid)).not.toContain(uuid)
    expect(readTasks(['anytime'], TODAY).map(t => t.uuid)).not.toContain(uuid)
  })

  it('files a to-do into the Inbox', () => {
    const uuid = create('Think about it later', 'inbox')

    expect(readTasks(['inbox'], TODAY).map(t => t.uuid)).toContain(uuid)
    expect(readTasks(['today'], TODAY).map(t => t.uuid)).not.toContain(uuid)
  })

  it('separates Anytime from Someday', () => {
    const anytime = create('Anytime thing', 'anytime')
    const someday = create('Someday thing', 'someday')

    expect(readTasks(['anytime'], TODAY).map(t => t.uuid)).toEqual([anytime])
    expect(readTasks(['someday'], TODAY).map(t => t.uuid)).toEqual([someday])
  })

  it('creates it open, untrashed and as a to-do rather than a project', () => {
    const uuid = create('Plain to-do', 'today')
    const row = db.prepare('SELECT status, in_trash, deleted, type FROM things_tasks WHERE uuid = ?').get(uuid) as Record<string, number>

    // A project (type 1) here would put a heading in the list instead of work.
    expect(row).toEqual({ status: 0, in_trash: 0, deleted: 0, type: 0 })
  })

  it('carries every field Things.app writes, so the item is not half-formed', () => {
    const fields = createdTaskFields('Full payload', 'today', TODAY)

    // A create merges onto nothing, so a sparse one leaves gaps on other
    // devices. This is the shape Things.app itself commits.
    for (const key of ['tp', 'sr', 'ss', 'tr', 'st', 'ar', 'tt', 'tir', 'tg', 'ix', 'cd', 'md', 'nt', 'pr', 'sb', 'xx']) {
      expect(fields).toHaveProperty(key)
    }
    expect(fields.tt).toBe('Full payload')
    expect(fields.st).toBe(1)
    expect(fields.sr).toBe(TODAY)
    expect(fields.ss).toBe(0)
  })

  it('leaves an undated to-do with no scheduled date at all', () => {
    // `st: 1` with a date is Today and without one is Anytime, so a stray
    // timestamp here would silently move it into Today.
    expect(createdTaskFields('x', 'anytime', TODAY).sr).toBeNull()
    expect(createdTaskFields('x', 'someday', TODAY).sr).toBeNull()
    expect(createdTaskFields('x', 'inbox', TODAY).sr).toBeNull()
  })
})
