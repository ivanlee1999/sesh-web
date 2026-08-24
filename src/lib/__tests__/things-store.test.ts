import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('server-only', () => ({}))

/**
 * A real in-memory SQLite, not a stub: the merge rules under test live in the
 * SQL itself (COALESCE and the @xSet guards), so faking the driver would test
 * nothing that matters.
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

import { applyItems, readTaskNote, readTasks } from '../things-store'

const DAY = 86_400
const todaySeconds = Math.floor(new Date().setHours(9, 0, 0, 0) / 1000)

function task(uuid: string, payload: Record<string, unknown>, action = 0) {
  return { uuid, kind: 'Task6', action, payload }
}

beforeEach(() => {
  db.exec('DELETE FROM things_tasks; DELETE FROM things_areas; DELETE FROM things_tags; DELETE FROM things_task_tags;')
})

describe('replaying the event log', () => {
  it('builds a task from a create', () => {
    applyItems([task('t1', { tt: 'Write the memo', st: 1, sr: todaySeconds, tp: 0, ss: 0 })])
    expect(readTasks(['today'])).toMatchObject([{ uuid: 't1', title: 'Write the memo' }])
  })

  it('treats an absent field on a modify as unchanged, not as null', () => {
    applyItems([task('t1', { tt: 'Original', st: 1, sr: todaySeconds, tp: 0, ss: 0 })])
    // A status-only modify, exactly as Things sends when you tick something.
    applyItems([task('t1', { ss: 0 }, 1)])

    const [found] = readTasks(['today'])
    expect(found.title).toBe('Original')
    expect(found.scheduledAt).toBe(todaySeconds)
  })

  it('applies an explicit null, which is how a task loses its date', () => {
    applyItems([task('t1', { tt: 'Someday thing', st: 1, sr: todaySeconds, tp: 0, ss: 0 })])
    applyItems([task('t1', { sr: null }, 1)])

    expect(readTasks(['today'])).toEqual([])
    expect(readTasks(['anytime'])).toMatchObject([{ uuid: 't1', scheduledAt: null }])
  })

  it('hides a task once it is completed, deleted or trashed', () => {
    applyItems([
      task('done', { tt: 'Done', st: 1, sr: todaySeconds, tp: 0, ss: 3 }),
      task('trashed', { tt: 'Trashed', st: 1, sr: todaySeconds, tp: 0, ss: 0, tr: true }),
      task('gone', { tt: 'Gone', st: 1, sr: todaySeconds, tp: 0, ss: 0 }),
    ])
    applyItems([task('gone', {}, 2)])

    expect(readTasks(['today'])).toEqual([])
  })

  it('leaves projects and headings out of the task list', () => {
    applyItems([
      task('p1', { tt: 'A project', st: 1, sr: todaySeconds, tp: 1, ss: 0 }),
      task('t1', { tt: 'A to-do', st: 1, sr: todaySeconds, tp: 0, ss: 0 }),
    ])
    expect(readTasks(['today']).map(t => t.uuid)).toEqual(['t1'])
  })

  it('resolves area and project names for the group heading', () => {
    applyItems([
      { uuid: 'a1', kind: 'Area3', action: 0, payload: { tt: 'Work' } },
      task('p1', { tt: 'Big project', tp: 1, ss: 0 }),
      task('t1', { tt: 'Child task', st: 1, sr: todaySeconds, tp: 0, ss: 0, ar: ['a1'], pr: ['p1'] }),
    ])
    expect(readTasks(['today'])[0]).toMatchObject({ areaTitle: 'Work', projectTitle: 'Big project' })
  })

  it('replaces the tag set on each modify that mentions tags', () => {
    applyItems([
      { uuid: 'g1', kind: 'Tag3', action: 0, payload: { tt: 'urgent' } },
      { uuid: 'g2', kind: 'Tag3', action: 0, payload: { tt: 'later' } },
      task('t1', { tt: 'Tagged', st: 1, sr: todaySeconds, tp: 0, ss: 0, tg: ['g1', 'g2'] }),
    ])
    expect(readTasks(['today'])[0].tags.sort()).toEqual(['later', 'urgent'])

    applyItems([task('t1', { tg: ['g1'] }, 1)])
    expect(readTasks(['today'])[0].tags).toEqual(['urgent'])
  })

  it('keeps a note across a modify that does not mention it', () => {
    applyItems([task('t1', { tt: 'Noted', st: 1, sr: todaySeconds, tp: 0, ss: 0, nt: { t: 1, v: 'remember this' } })])
    applyItems([task('t1', { tt: 'Noted again' }, 1)])
    expect(readTaskNote('t1')).toBe('remember this')
  })
})

describe('the view a task lands in', () => {
  it('sorts by schedule and date the way Things does', () => {
    applyItems([
      task('inbox', { tt: 'Inbox', st: 0, tp: 0, ss: 0 }),
      task('today', { tt: 'Today', st: 1, sr: todaySeconds, tp: 0, ss: 0 }),
      task('anytime', { tt: 'Anytime', st: 1, sr: null, tp: 0, ss: 0 }),
      task('later', { tt: 'Later', st: 1, sr: todaySeconds + 7 * DAY, tp: 0, ss: 0 }),
      task('someday', { tt: 'Someday', st: 2, sr: null, tp: 0, ss: 0 }),
    ])

    expect(readTasks(['inbox']).map(t => t.uuid)).toEqual(['inbox'])
    expect(readTasks(['today']).map(t => t.uuid)).toEqual(['today'])
    expect(readTasks(['anytime']).map(t => t.uuid)).toEqual(['anytime'])
    expect(readTasks(['upcoming']).map(t => t.uuid)).toEqual(['later'])
    expect(readTasks(['someday']).map(t => t.uuid)).toEqual(['someday'])
  })

  it('surfaces an overdue task in Today rather than hiding it', () => {
    applyItems([task('overdue', { tt: 'Overdue', st: 1, sr: todaySeconds - 3 * DAY, tp: 0, ss: 0 })])
    expect(readTasks(['today']).map(t => t.uuid)).toEqual(['overdue'])
  })

  it('returns a task once even when several views would match', () => {
    applyItems([
      task('t1', { tt: 'Today', st: 1, sr: todaySeconds, tp: 0, ss: 0 }),
      task('t2', { tt: 'Inbox', st: 0, tp: 0, ss: 0 }),
    ])
    const all = readTasks(['today', 'upcoming', 'anytime', 'inbox'])
    expect(all.map(t => t.uuid).sort()).toEqual(['t1', 't2'])
  })
})
