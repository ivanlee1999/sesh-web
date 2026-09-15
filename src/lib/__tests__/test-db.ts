import Database from 'better-sqlite3'
import { initSchema } from '@/lib/server-db'

/**
 * A real database, in memory, with the real schema.
 *
 * Not a stand-in built out of maps: the parts under test here are triggers,
 * upsert conflict clauses and a monotonic counter, none of which a fake would
 * reproduce — and getting those wrong is precisely the failure that would cost
 * somebody their sessions.
 */
export function makeTestDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

/** The schema as it stood before sync — to test the migration onto it. */
export function makeLegacyDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      intention TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      type TEXT NOT NULL DEFAULT 'focus',
      target_ms INTEGER NOT NULL DEFAULT 0,
      actual_ms INTEGER NOT NULL DEFAULT 0,
      overflow_ms INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      google_event_id TEXT NOT NULL DEFAULT '',
      is_synced INTEGER NOT NULL DEFAULT 0,
      todoist_task_id TEXT,
      rating INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  return db
}

export interface SessionSeed {
  id?: string
  intention?: string
  category?: string
  type?: string
  startedAt?: number
  endedAt?: number
  targetMs?: number
  actualMs?: number
  rating?: number
  taskRefs?: string | null
  updatedAt?: number
}

export function insertSession(db: Database.Database, seed: SessionSeed = {}): string {
  const startedAt = seed.startedAt ?? 1_700_000_000_000
  const id = seed.id ?? `manual-${startedAt}`
  db.prepare(`
    INSERT INTO sessions
      (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes, rating, todoist_task_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, '', ?, ?, ?)
  `).run(
    id,
    seed.intention ?? 'Write the plan',
    seed.category ?? 'deep',
    seed.type ?? 'focus',
    seed.targetMs ?? 1_500_000,
    seed.actualMs ?? 1_500_000,
    startedAt,
    seed.endedAt ?? startedAt + 1_500_000,
    seed.rating ?? 0,
    seed.taskRefs ?? null,
    seed.updatedAt ?? 0,
  )
  return id
}

export function categoryNamed(db: Database.Database, name: string) {
  return db.prepare('SELECT * FROM categories WHERE name = ?').get(name) as
    { id: string; name: string; label: string; color: string; updated_at: number; deleted_at: number | null } | undefined
}
