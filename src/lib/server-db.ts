import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'sesh.db')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    initSchema(db)
  }
  return db
}

function ensureColumn(d: Database.Database, table: string, column: string, ddl: string) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some(c => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

function initSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
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
      is_synced INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

    CREATE TABLE IF NOT EXISTS timer_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      phase TEXT NOT NULL DEFAULT 'idle',
      session_type TEXT NOT NULL DEFAULT 'focus',
      intention TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'development',
      target_ms INTEGER NOT NULL DEFAULT 0,
      remaining_ms INTEGER NOT NULL DEFAULT 0,
      overflow_ms INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      paused_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO timer_state (id, updated_at) VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS google_oauth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO google_oauth (id, updated_at) VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `)

  // Migrations: add todoist_task_id to sessions and timer_state
  ensureColumn(d, 'sessions', 'todoist_task_id', 'todoist_task_id TEXT')
  ensureColumn(d, 'sessions', 'rating', 'rating INTEGER NOT NULL DEFAULT 0')
  ensureColumn(d, 'timer_state', 'todoist_task_id', 'todoist_task_id TEXT')
  ensureColumn(d, 'timer_state', 'notification_count', 'notification_count INTEGER NOT NULL DEFAULT 0')

  // Migrations: add google_event_id and is_synced to sessions
  ensureColumn(d, 'sessions', 'google_event_id', "google_event_id TEXT NOT NULL DEFAULT ''")
  ensureColumn(d, 'sessions', 'is_synced', 'is_synced INTEGER NOT NULL DEFAULT 0')

  // Google OAuth migrations: cache calendar ID and track scope
  ensureColumn(d, 'google_oauth', 'calendar_id', "calendar_id TEXT NOT NULL DEFAULT ''")
  ensureColumn(d, 'google_oauth', 'scope', "scope TEXT NOT NULL DEFAULT ''")

  // Categories table
  d.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);
  `)

  // Seed default categories if table is empty
  const count = d.prepare('SELECT COUNT(*) as cnt FROM categories').get() as { cnt: number }
  if (count.cnt === 0) {
    const insert = d.prepare(
      'INSERT INTO categories (id, name, label, color, sort_order, is_default) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const defaults = [
      ['deep', 'Deep Work', '#BE6E45', 0, 1],
      ['writing', 'Writing', '#6E86B0', 1, 0],
      ['study', 'Study', '#7E9476', 2, 0],
      ['reading', 'Reading', '#C8943A', 3, 0],
      ['design', 'Design', '#9B6F8C', 4, 0],
    ] as const
    for (const [name, label, color, order, isDefault] of defaults) {
      insert.run(crypto.randomUUID(), name, label, color, order, isDefault)
    }
  }

  migrateLegacyDefaultCategories(d)
}

function migrateLegacyDefaultCategories(d: Database.Database) {
  const rows = d.prepare('SELECT name FROM categories ORDER BY name').all() as Array<{ name: string }>
  const legacyNames = ['design', 'development', 'exercise', 'learning', 'other', 'writing']
  const isExactLegacySet = rows.length === legacyNames.length
    && rows.every((row, index) => row.name === legacyNames[index])

  if (!isExactLegacySet) return

  const update = d.prepare(`
    UPDATE categories
    SET label = ?, color = ?, sort_order = ?, is_default = ?
    WHERE name = ?
  `)
  const legacyHandoffDefaults = [
    ['development', 'Deep Work', '#BE6E45', 0, 1],
    ['writing', 'Writing', '#6E86B0', 1, 0],
    ['learning', 'Study', '#7E9476', 2, 0],
    ['design', 'Design', '#9B6F8C', 3, 0],
    ['exercise', 'Movement', '#5E9AA0', 4, 0],
    ['other', 'Admin', '#8A7B5C', 5, 0],
  ] as const

  const migrate = d.transaction(() => {
    for (const [name, label, color, sortOrder, isDefault] of legacyHandoffDefaults) {
      update.run(label, color, sortOrder, isDefault, name)
    }
  })
  migrate()
}
