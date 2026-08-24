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

/**
 * Things writes a scheduled date as the UTC midnight of a floating calendar
 * day — the exact shape a Things 3.15 capture shows on the wire — so the tests
 * use that rather than an arbitrary instant, and read it back against the same
 * UTC day boundary the app now passes in.
 */
const todaySeconds = Date.UTC(2026, 7, 24) / 1000
/** The same instant, named for its other role: the boundary readTasks asks about. */
const todayStart = todaySeconds

function task(uuid: string, payload: Record<string, unknown>, action = 0) {
  return { uuid, kind: 'Task6', action, payload }
}

beforeEach(() => {
  db.exec('DELETE FROM things_tasks; DELETE FROM things_areas; DELETE FROM things_tags; DELETE FROM things_task_tags;')
})

describe('replaying the event log', () => {
  it('builds a task from a create', () => {
    applyItems([task('t1', { tt: 'Write the memo', st: 1, sr: todaySeconds, tp: 0, ss: 0 })])
    expect(readTasks(['today'], todayStart)).toMatchObject([{ uuid: 't1', title: 'Write the memo' }])
  })

  it('treats an absent field on a modify as unchanged, not as null', () => {
    applyItems([task('t1', { tt: 'Original', st: 1, sr: todaySeconds, tp: 0, ss: 0 })])
    // A status-only modify, exactly as Things sends when you tick something.
    applyItems([task('t1', { ss: 0 }, 1)])

    const [found] = readTasks(['today'], todayStart)
    expect(found.title).toBe('Original')
    expect(found.scheduledAt).toBe(todaySeconds)
  })

  it('applies an explicit null, which is how a task loses its date', () => {
    applyItems([task('t1', { tt: 'Someday thing', st: 1, sr: todaySeconds, tp: 0, ss: 0 })])
    applyItems([task('t1', { sr: null }, 1)])

    expect(readTasks(['today'], todayStart)).toEqual([])
    expect(readTasks(['anytime'], todayStart)).toMatchObject([{ uuid: 't1', scheduledAt: null }])
  })

  it('hides a task once it is completed, deleted or trashed', () => {
    applyItems([
      task('done', { tt: 'Done', st: 1, sr: todaySeconds, tp: 0, ss: 3 }),
      task('trashed', { tt: 'Trashed', st: 1, sr: todaySeconds, tp: 0, ss: 0, tr: true }),
      task('gone', { tt: 'Gone', st: 1, sr: todaySeconds, tp: 0, ss: 0 }),
    ])
    applyItems([task('gone', {}, 2)])

    expect(readTasks(['today'], todayStart)).toEqual([])
  })

  it('leaves projects and headings out of the task list', () => {
    applyItems([
      task('p1', { tt: 'A project', st: 1, sr: todaySeconds, tp: 1, ss: 0 }),
      task('t1', { tt: 'A to-do', st: 1, sr: todaySeconds, tp: 0, ss: 0 }),
    ])
    expect(readTasks(['today'], todayStart).map(t => t.uuid)).toEqual(['t1'])
  })

  it('resolves area and project names for the group heading', () => {
    applyItems([
      { uuid: 'a1', kind: 'Area3', action: 0, payload: { tt: 'Work' } },
      task('p1', { tt: 'Big project', tp: 1, ss: 0 }),
      task('t1', { tt: 'Child task', st: 1, sr: todaySeconds, tp: 0, ss: 0, ar: ['a1'], pr: ['p1'] }),
    ])
    expect(readTasks(['today'], todayStart)[0]).toMatchObject({ areaTitle: 'Work', projectTitle: 'Big project' })
  })

  it('replaces the tag set on each modify that mentions tags', () => {
    applyItems([
      { uuid: 'g1', kind: 'Tag3', action: 0, payload: { tt: 'urgent' } },
      { uuid: 'g2', kind: 'Tag3', action: 0, payload: { tt: 'later' } },
      task('t1', { tt: 'Tagged', st: 1, sr: todaySeconds, tp: 0, ss: 0, tg: ['g1', 'g2'] }),
    ])
    expect(readTasks(['today'], todayStart)[0].tags.sort()).toEqual(['later', 'urgent'])

    applyItems([task('t1', { tg: ['g1'] }, 1)])
    expect(readTasks(['today'], todayStart)[0].tags).toEqual(['urgent'])
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

    expect(readTasks(['inbox'], todayStart).map(t => t.uuid)).toEqual(['inbox'])
    expect(readTasks(['today'], todayStart).map(t => t.uuid)).toEqual(['today'])
    expect(readTasks(['anytime'], todayStart).map(t => t.uuid)).toEqual(['anytime'])
    expect(readTasks(['upcoming'], todayStart).map(t => t.uuid)).toEqual(['later'])
    expect(readTasks(['someday'], todayStart).map(t => t.uuid)).toEqual(['someday'])
  })

  it('surfaces an overdue task in Today rather than hiding it', () => {
    applyItems([task('overdue', { tt: 'Overdue', st: 1, sr: todaySeconds - 3 * DAY, tp: 0, ss: 0 })])
    expect(readTasks(['today'], todayStart).map(t => t.uuid)).toEqual(['overdue'])
  })

  it('returns a task once even when several views would match', () => {
    applyItems([
      task('t1', { tt: 'Today', st: 1, sr: todaySeconds, tp: 0, ss: 0 }),
      task('t2', { tt: 'Inbox', st: 0, tp: 0, ss: 0 }),
    ])
    const all = readTasks(['today', 'upcoming', 'anytime', 'inbox'], todayStart)
    expect(all.map(t => t.uuid).sort()).toEqual(['t1', 't2'])
  })
})

describe('which day the Today view means', () => {
  /**
   * The regression this guards: the boundary used to be built from the
   * server's own clock, so a UTC container put tomorrow's tasks in Today for
   * anyone west of it and hid today's from anyone east. The boundary is now
   * handed in by the caller, who knows where the viewer is.
   */
  it('follows the viewer, not the machine', () => {
    applyItems([
      task('today', { tt: 'Today', st: 1, sr: Date.UTC(2026, 7, 24) / 1000, tp: 0, ss: 0 }),
      task('tomorrow', { tt: 'Tomorrow', st: 1, sr: Date.UTC(2026, 7, 25) / 1000, tp: 0, ss: 0 }),
    ])

    const onThe24th = Date.UTC(2026, 7, 24) / 1000
    const onThe25th = Date.UTC(2026, 7, 25) / 1000

    expect(readTasks(['today'], onThe24th).map(t => t.uuid)).toEqual(['today'])
    expect(readTasks(['upcoming'], onThe24th).map(t => t.uuid)).toEqual(['tomorrow'])

    // A viewer for whom it is already the 25th sees both, the 24th as overdue.
    expect(readTasks(['today'], onThe25th).map(t => t.uuid).sort()).toEqual(['today', 'tomorrow'])
    expect(readTasks(['upcoming'], onThe25th)).toEqual([])
  })

  it('puts a task scheduled for the viewer today in Today, not Upcoming', () => {
    applyItems([task('t1', { tt: 'Due today', st: 1, sr: todaySeconds, tp: 0, ss: 0 })])
    expect(readTasks(['today'], todayStart).map(t => t.uuid)).toEqual(['t1'])
    expect(readTasks(['upcoming'], todayStart)).toEqual([])
  })
})

describe('kinds the replay must not drop', () => {
  /**
   * The regression this guards. The number on a kind is a schema version, and
   * one history holds every version it has ever written. `Task7` was not on
   * the recognised list, so when it began carrying completions they were
   * dropped in silence and finished tasks kept reappearing as open work.
   */
  it('accepts a task schema version it has never seen', () => {
    applyItems([{ uuid: 't1', kind: 'Task6', action: 0, payload: { tt: 'Done later', st: 1, sr: todaySeconds, tp: 0, ss: 0 } }])
    expect(readTasks(['today'], todayStart).map(t => t.uuid)).toEqual(['t1'])

    applyItems([{ uuid: 't1', kind: 'Task7', action: 1, payload: { ss: 3 } }])
    expect(readTasks(['today'], todayStart)).toEqual([])

    applyItems([{ uuid: 't2', kind: 'Task9', action: 0, payload: { tt: 'From the future', st: 1, sr: todaySeconds, tp: 0, ss: 0 } }])
    expect(readTasks(['today'], todayStart).map(t => t.uuid)).toEqual(['t2'])
  })

  it('still ignores kinds that are not tasks, areas or tags', () => {
    applyItems([
      { uuid: 'c1', kind: 'ChecklistItem3', action: 0, payload: { tt: 'A step', st: 1, sr: todaySeconds, tp: 0, ss: 0 } },
      { uuid: 'x1', kind: 'Tombstone2', action: 0, payload: { tt: 'Gone', st: 1, sr: todaySeconds, tp: 0, ss: 0 } },
    ])
    expect(readTasks(['today'], todayStart)).toEqual([])
  })
})

describe('to-dos under a project that is gone', () => {
  /** Things takes a project's to-dos out of its lists along with the project. */
  it('hides them when the project is trashed, finished or deleted', () => {
    applyItems([
      task('live', { tt: 'Live project', tp: 1, ss: 0 }),
      task('trashed', { tt: 'Trashed project', tp: 1, ss: 0, tr: true }),
      task('done', { tt: 'Finished project', tp: 1, ss: 3 }),
      task('a', { tt: 'Under live', st: 1, sr: todaySeconds, tp: 0, ss: 0, pr: ['live'] }),
      task('b', { tt: 'Under trashed', st: 1, sr: todaySeconds, tp: 0, ss: 0, pr: ['trashed'] }),
      task('c', { tt: 'Under finished', st: 1, sr: todaySeconds, tp: 0, ss: 0, pr: ['done'] }),
      task('d', { tt: 'No project', st: 1, sr: todaySeconds, tp: 0, ss: 0 }),
    ])

    expect(readTasks(['today'], todayStart).map(t => t.uuid).sort()).toEqual(['a', 'd'])
  })
})
