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
      notes TEXT NOT NULL DEFAULT ''
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
  `)
}
