import type Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { initSchema } from '@/lib/server-db'
import { applyOps, pullChanges, pruneSyncOps, type SyncOp } from '@/lib/sync'
import { categoryNamed, insertSession, makeLegacyDb, makeTestDb } from './test-db'

let db: Database.Database

beforeEach(() => {
  db = makeTestDb()
})

function op(kind: string, payload: Record<string, unknown>, opId = crypto.randomUUID()): SyncOp {
  return { opId, kind, payload }
}

function sessionRow(id: string) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
}

// ── Change tracking ─────────────────────────────────────────────────────

describe('seq and updated_at', () => {
  it('stamps an inserted row with a sequence and a time', () => {
    const before = Date.now()
    const id = insertSession(db)
    const row = sessionRow(id)!
    expect(row.seq).toBeGreaterThan(0)
    /*
     * SQLite's julianday truncates, so its idea of "now" can sit a millisecond
     * behind the one JavaScript just read. That is well inside the tolerance
     * of anything comparing edit times, but it is why this is a window rather
     * than a >=.
     */
    expect(row.updated_at as number).toBeGreaterThanOrEqual(before - 2)
    expect(row.updated_at as number).toBeLessThanOrEqual(Date.now() + 2)
  })

  it('hands out a distinct, increasing sequence per write', () => {
    const a = insertSession(db, { startedAt: 1000 })
    const b = insertSession(db, { startedAt: 2000 })
    expect(sessionRow(b)!.seq as number).toBeGreaterThan(sessionRow(a)!.seq as number)

    const seqBefore = sessionRow(a)!.seq as number
    db.prepare('UPDATE sessions SET intention = ? WHERE id = ?').run('edited', a)
    expect(sessionRow(a)!.seq as number).toBeGreaterThan(seqBefore)
  })

  it('keeps updated_at when only calendar bookkeeping changes', () => {
    // Otherwise a calendar sync would date itself as a fresh edit and beat a
    // genuine one made on a phone that has not synced yet.
    const id = insertSession(db)
    const before = sessionRow(id)!
    db.prepare('UPDATE sessions SET google_event_id = ?, is_synced = 1 WHERE id = ?').run('evt-1', id)
    const after = sessionRow(id)!

    expect(after.updated_at).toBe(before.updated_at)
    expect(after.seq as number).toBeGreaterThan(before.seq as number)
  })

  it('honours an explicitly supplied updated_at', () => {
    const id = insertSession(db, { updatedAt: 1_234_567_890 })
    expect(sessionRow(id)!.updated_at).toBe(1_234_567_890)
  })

  it('does not advance the counter for an insert that was ignored', () => {
    const id = insertSession(db)
    const seq = db.prepare('SELECT seq FROM sync_meta WHERE id = 1').get() as { seq: number }
    db.prepare(`
      INSERT OR IGNORE INTO sessions (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes)
      VALUES (?, 'dupe', 'deep', 'focus', 0, 0, 0, 1, 2, '')
    `).run(id)
    expect((db.prepare('SELECT seq FROM sync_meta WHERE id = 1').get() as { seq: number }).seq).toBe(seq.seq)
  })
})

describe('migration from the pre-sync schema', () => {
  it('backfills every existing row so nothing is invisible to a first sync', () => {
    const legacy = makeLegacyDb()
    legacy.prepare(`
      INSERT INTO sessions (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes)
      VALUES ('manual-1', 'old work', 'deep', 'focus', 10, 10, 0, 1000, 2000, '')
    `).run()
    legacy.prepare("INSERT INTO categories (id, name, label, color, sort_order, is_default) VALUES ('c1','deep','Deep','#000',0,1)").run()
    legacy.prepare("INSERT INTO settings (key, value) VALUES ('darkMode', 'true')").run()

    initSchema(legacy)

    const session = legacy.prepare("SELECT seq, updated_at FROM sessions WHERE id = 'manual-1'").get() as { seq: number; updated_at: number }
    expect(session.seq).toBeGreaterThan(0)
    // A session's best evidence of when it last changed is when it ended.
    expect(session.updated_at).toBe(2000)

    for (const table of ['categories', 'settings']) {
      const zero = legacy.prepare(`SELECT COUNT(*) c FROM ${table} WHERE seq = 0`).get() as { c: number }
      expect(zero.c).toBe(0)
    }

    // Idempotent: running it again must not renumber or duplicate anything.
    const before = legacy.prepare('SELECT seq FROM sync_meta WHERE id = 1').get() as { seq: number }
    initSchema(legacy)
    expect((legacy.prepare('SELECT seq FROM sync_meta WHERE id = 1').get() as { seq: number }).seq).toBe(before.seq)
  })
})

// ── Pull ────────────────────────────────────────────────────────────────

describe('pullChanges', () => {
  it('returns everything from a zero cursor', () => {
    insertSession(db, { startedAt: 1000 })
    const pull = pullChanges(db, 0)
    expect(pull.changes.sessions).toHaveLength(1)
    // The seeded categories come along on a first sync.
    expect(pull.changes.categories.length).toBeGreaterThan(0)
    expect(pull.hasMore).toBe(false)
  })

  it('returns only what changed after the cursor', () => {
    const first = pullChanges(db, 0)
    insertSession(db, { startedAt: 5000 })
    const next = pullChanges(db, first.cursor)

    expect(next.changes.categories).toHaveLength(0)
    expect(next.changes.sessions).toHaveLength(1)
    expect(next.cursor).toBeGreaterThan(first.cursor)
  })

  it('pages without skipping a row between the page end and the head', () => {
    for (let i = 0; i < 12; i += 1) insertSession(db, { startedAt: 10_000 + i })

    const seen = new Set<string>()
    let cursor = 0
    let guard = 0
    for (;;) {
      const page = pullChanges(db, cursor, 5)
      for (const s of page.changes.sessions) seen.add(s.id)
      cursor = page.cursor
      if (!page.hasMore || (guard += 1) > 20) break
    }

    expect(seen.size).toBe(12)
  })

  it('carries tombstones so a client can learn about a deletion it missed', () => {
    const id = insertSession(db)
    const start = pullChanges(db, 0).cursor
    db.prepare('UPDATE sessions SET deleted_at = ? WHERE id = ?').run(Date.now(), id)

    const pull = pullChanges(db, start)
    expect(pull.changes.sessions).toHaveLength(1)
    expect(pull.changes.sessions[0].deletedAt).not.toBeNull()
  })

  it('parses stored settings back into values', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('focusDuration', '25')").run()
    const pull = pullChanges(db, 0)
    expect(pull.changes.settings).toContainEqual(expect.objectContaining({ key: 'focusDuration', value: 25 }))
  })
})

// ── Push ────────────────────────────────────────────────────────────────

describe('session.complete', () => {
  const payload = {
    id: 'manual-900',
    intention: 'Offline work',
    category: 'deep',
    type: 'focus',
    targetMs: 1_500_000,
    actualMs: 1_600_000,
    overflowMs: 100_000,
    startedAt: 900,
    endedAt: 1_600_900,
    notes: '',
    rating: 5,
    todoistTaskId: 'things:abc',
    updatedAt: 2_000,
  }

  it('writes a session that was finished with no network', () => {
    const { results, effects } = applyOps(db, [op('session.complete', payload)], 'phone')
    expect(results[0].status).toBe('applied')
    expect(effects).toHaveLength(1)
    expect(effects[0].isNew).toBe(true)

    const row = sessionRow('manual-900')!
    expect(row.intention).toBe('Offline work')
    expect(row.rating).toBe(5)
    expect(row.todoist_task_id).toBe('things:abc')
    expect(row.updated_at).toBe(2_000)
  })

  it('replays a lost reply without writing the session twice', () => {
    const one = op('session.complete', payload, 'op-1')
    applyOps(db, [one], 'phone')
    const { results, effects } = applyOps(db, [one], 'phone')

    expect(results[0].status).toBe('duplicate')
    // Nothing to re-announce, and no minutes to add to the task a second time.
    expect(effects).toHaveLength(0)
    const count = db.prepare('SELECT COUNT(*) c FROM sessions').get() as { c: number }
    expect(count.c).toBe(1)
  })

  it('does not treat a second arrival as new work', () => {
    applyOps(db, [op('session.complete', payload, 'op-a')], 'phone')
    const { effects } = applyOps(db, [op('session.complete', { ...payload, intention: 'Edited', updatedAt: 3_000 }, 'op-b')], 'phone')
    expect(effects[0].isNew).toBe(false)
    expect(sessionRow('manual-900')!.intention).toBe('Edited')
  })

  it('never lets a client revise the timings', () => {
    applyOps(db, [op('session.complete', payload, 'op-a')], 'phone')
    applyOps(db, [op('session.complete', { ...payload, actualMs: 99, targetMs: 99, updatedAt: 9_000 }, 'op-b')], 'phone')
    const row = sessionRow('manual-900')!
    expect(row.actual_ms).toBe(1_600_000)
    expect(row.target_ms).toBe(1_500_000)
  })

  it('keeps the newer edit when the server has moved on', () => {
    applyOps(db, [op('session.complete', { ...payload, updatedAt: 5_000 }, 'op-a')], 'phone')
    const { results } = applyOps(db, [op('session.complete', { ...payload, intention: 'Older', updatedAt: 1_000 }, 'op-b')], 'phone')

    expect(results[0].status).toBe('stale')
    expect(sessionRow('manual-900')!.intention).toBe('Offline work')
  })

  it('files a session under the fallback when its category has gone, and says so', () => {
    const { results } = applyOps(db, [op('session.complete', { ...payload, category: 'vanished' })], 'phone')
    expect(results[0].status).toBe('applied')
    expect(results[0].category?.name).toBe('deep')
    expect(sessionRow('manual-900')!.category).toBe('deep')
  })

  it('retires the shared timer when it was still showing this session', () => {
    db.prepare("UPDATE timer_state SET phase = 'running', started_at = 900, target_ms = 1500000 WHERE id = 1").run()
    applyOps(db, [op('session.complete', payload)], 'phone')

    const timer = db.prepare('SELECT phase, started_at FROM timer_state WHERE id = 1').get() as { phase: string; started_at: number | null }
    expect(timer.phase).toBe('idle')
    expect(timer.started_at).toBeNull()
  })

  it('leaves a timer belonging to a different session alone', () => {
    db.prepare("UPDATE timer_state SET phase = 'running', started_at = 777 WHERE id = 1").run()
    applyOps(db, [op('session.complete', payload)], 'phone')
    const timer = db.prepare('SELECT phase, started_at FROM timer_state WHERE id = 1').get() as { phase: string; started_at: number }
    expect(timer.phase).toBe('running')
    expect(timer.started_at).toBe(777)
  })
})

describe('session.upsert and session.delete', () => {
  it('edits only the fields a person can edit', () => {
    const id = insertSession(db, { updatedAt: 1_000 })
    applyOps(db, [op('session.upsert', { id, intention: 'Renamed', rating: 3, updatedAt: 2_000 })], 'phone')

    const row = sessionRow(id)!
    expect(row.intention).toBe('Renamed')
    expect(row.rating).toBe(3)
    expect(row.actual_ms).toBe(1_500_000)
  })

  it('refuses an edit older than the server copy', () => {
    const id = insertSession(db, { updatedAt: 5_000 })
    const { results } = applyOps(db, [op('session.upsert', { id, intention: 'Stale', updatedAt: 1_000 })], 'phone')
    expect(results[0].status).toBe('stale')
    expect(sessionRow(id)!.intention).toBe('Write the plan')
  })

  it('tombstones rather than removes, so other devices can find out', () => {
    const id = insertSession(db)
    applyOps(db, [op('session.delete', { id, deletedAt: 7_000 })], 'phone')

    const row = sessionRow(id)!
    expect(row).toBeDefined()
    expect(row.deleted_at).toBe(7_000)
  })

  it('treats deleting an unknown session as already done', () => {
    const { results } = applyOps(db, [op('session.delete', { id: 'never-existed' })], 'phone')
    expect(results[0].status).toBe('applied')
  })
})

describe('category operations', () => {
  it('carries a rename into the sessions filed under the old slug', () => {
    const id = insertSession(db, { category: 'deep' })
    const deep = categoryNamed(db, 'deep')!

    applyOps(db, [op('category.upsert', {
      id: deep.id, name: 'deep-work', label: 'Deep Work', color: '#c0522d', updatedAt: Date.now(),
    })], 'phone')

    expect(sessionRow(id)!.category).toBe('deep-work')
    expect(categoryNamed(db, 'deep-work')).toBeDefined()
  })

  it('refuses a name another category already answers to, and names the winner', () => {
    const deep = categoryNamed(db, 'deep')!
    const { results } = applyOps(db, [op('category.upsert', {
      id: crypto.randomUUID(), name: 'deep', label: 'Deep', color: '#000', updatedAt: Date.now(),
    })], 'phone')

    expect(results[0].status).toBe('rejected')
    expect(results[0].category?.id).toBe(deep.id)
  })

  it('creates a category the phone invented offline', () => {
    const id = crypto.randomUUID()
    const { results } = applyOps(db, [op('category.upsert', {
      id, name: 'admin', label: 'Admin', color: '#8a857f', updatedAt: Date.now(),
    })], 'phone')

    expect(results[0].status).toBe('applied')
    expect(categoryNamed(db, 'admin')?.id).toBe(id)
  })

  it('will not delete a category with history behind it', () => {
    insertSession(db, { category: 'deep' })
    const deep = categoryNamed(db, 'deep')!
    const { results } = applyOps(db, [op('category.delete', { id: deep.id })], 'phone')

    expect(results[0].status).toBe('rejected')
    expect(results[0].sessionCount).toBe(1)
    expect(categoryNamed(db, 'deep')?.deleted_at).toBeNull()
  })

  it('deletes an unused category and moves the timer off it', () => {
    const writing = categoryNamed(db, 'writing')!
    db.prepare("UPDATE timer_state SET category = 'writing' WHERE id = 1").run()

    const { results } = applyOps(db, [op('category.delete', { id: writing.id })], 'phone')
    expect(results[0].status).toBe('applied')
    expect(categoryNamed(db, 'writing')?.deleted_at).not.toBeNull()

    const timer = db.prepare('SELECT category FROM timer_state WHERE id = 1').get() as { category: string }
    expect(timer.category).not.toBe('writing')
  })

  it('does not count a deleted session as history', () => {
    const id = insertSession(db, { category: 'writing' })
    db.prepare('UPDATE sessions SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
    const writing = categoryNamed(db, 'writing')!

    const { results } = applyOps(db, [op('category.delete', { id: writing.id })], 'phone')
    expect(results[0].status).toBe('applied')
  })
})

describe('settings.set', () => {
  it('writes a key and keeps the later of two edits', () => {
    applyOps(db, [op('settings.set', { key: 'focusDuration', value: 30, updatedAt: 2_000 })], 'phone')
    applyOps(db, [op('settings.set', { key: 'focusDuration', value: 15, updatedAt: 1_000 })], 'phone')

    const row = db.prepare("SELECT value FROM settings WHERE key = 'focusDuration'").get() as { value: string }
    expect(JSON.parse(row.value)).toBe(30)
  })
})

describe('timer.mirror', () => {
  it('records which device is running the timer', () => {
    applyOps(db, [op('timer.mirror', {
      phase: 'running', sessionType: 'focus', intention: 'Deep', category: 'deep',
      targetMs: 1_500_000, remainingMs: 900_000, startedAt: 1_000,
    })], 'iphone')

    const timer = db.prepare('SELECT phase, device_id, category FROM timer_state WHERE id = 1').get() as
      { phase: string; device_id: string; category: string }
    expect(timer.phase).toBe('running')
    expect(timer.device_id).toBe('iphone')
    expect(timer.category).toBe('deep')
  })
})

describe('batch behaviour', () => {
  it('applies the ops before the failure and reports the one that failed', () => {
    const results = applyOps(db, [
      op('session.complete', { id: 'manual-1', startedAt: 1, endedAt: 2, category: 'deep' }),
      op('nonsense.kind', {}),
      op('settings.set', { key: 'soundEnabled', value: false, updatedAt: 1_000 }),
    ], 'phone').results

    expect(results.map(r => r.status)).toEqual(['applied', 'rejected', 'applied'])
    expect(sessionRow('manual-1')).toBeDefined()
  })

  it('rejects an op with no id rather than guessing one', () => {
    const { results } = applyOps(db, [{ opId: '', kind: 'settings.set', payload: {} }], 'phone')
    expect(results[0].status).toBe('rejected')
  })

  it('forgets replay guards once they are older than any client would retry', () => {
    applyOps(db, [op('settings.set', { key: 'a', value: 1 }, 'old-op')], 'phone')
    db.prepare("UPDATE sync_ops SET created_at = ? WHERE op_id = 'old-op'").run(Date.now() - 40 * 24 * 60 * 60 * 1000)
    pruneSyncOps(db)
    expect(db.prepare("SELECT COUNT(*) c FROM sync_ops WHERE op_id = 'old-op'").get()).toEqual({ c: 0 })
  })
})
