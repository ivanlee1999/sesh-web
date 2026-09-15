import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'sesh.db')
const NETWORK_FS_TYPES = new Set([
  'nfs',
  'nfs4',
  'cifs',
  'smbfs',
  'sshfs',
  'fuse.sshfs',
  'davfs',
  'fuse.davfs',
  'glusterfs',
  'ceph',
  'ceph-fuse',
  'fuse.ceph',
  'lustre',
])
const UNSAFE_PATH_PREFIXES = ['/mnt/nas', '/mnt/synology']

type MountInfo = {
  mountPoint: string
  fsType: string
}

let db: Database.Database | null = null

export function isUnsafeNetworkFsType(fsType: string | null | undefined): boolean {
  return !!fsType && NETWORK_FS_TYPES.has(fsType.trim().toLowerCase())
}

export function findMountForPath(targetPath: string, mountsText: string): MountInfo | null {
  const normalizedTarget = path.posix.normalize(targetPath.replace(/\\/g, '/'))
  let bestMatch: MountInfo | null = null

  for (const line of mountsText.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const fields = trimmed.split(/\s+/)
    if (fields.length < 3) continue

    const mountPoint = fields[1].replace(/\\040/g, ' ')
    const fsType = fields[2]
    const normalizedMount = path.posix.normalize(mountPoint.replace(/\\/g, '/'))
    const isPrefix = normalizedTarget === normalizedMount
      || normalizedTarget.startsWith(`${normalizedMount}/`)

    if (!isPrefix) continue
    if (!bestMatch || normalizedMount.length > bestMatch.mountPoint.length) {
      bestMatch = { mountPoint: normalizedMount, fsType }
    }
  }

  return bestMatch
}

export function assertSafeSqliteStorage(
  dbPath: string,
  options: { realDbPath?: string; mountsText?: string } = {}
): void {
  const realDbPath = path.posix.normalize((options.realDbPath ?? dbPath).replace(/\\/g, '/'))

  if (UNSAFE_PATH_PREFIXES.some(prefix => realDbPath === prefix || realDbPath.startsWith(`${prefix}/`))) {
    throw new Error(
      `Refusing to open SQLite DB on unsafe network-mounted path: ${realDbPath}. `
      + 'Move sesh.db to local disk; SQLite WAL is not reliable on NAS/NFS mounts.'
    )
  }

  const mount = options.mountsText ? findMountForPath(realDbPath, options.mountsText) : null
  if (mount && isUnsafeNetworkFsType(mount.fsType)) {
    throw new Error(
      `Refusing to open SQLite DB on ${mount.fsType} mount ${mount.mountPoint}: ${realDbPath}. `
      + 'Move sesh.db to local disk; SQLite WAL is not reliable on network filesystems.'
    )
  }
}

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    let realDbPath = DB_PATH
    try {
      realDbPath = fs.realpathSync.native(DATA_DIR)
      realDbPath = path.join(realDbPath, path.basename(DB_PATH))
    } catch {
      realDbPath = DB_PATH
    }

    let mountsText = ''
    try {
      mountsText = fs.readFileSync('/proc/mounts', 'utf8')
    } catch {
      mountsText = ''
    }

    assertSafeSqliteStorage(DB_PATH, { realDbPath, mountsText })
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

/**
 * Exported so tests can build the real schema in memory. Every table, column,
 * trigger and backfill the app relies on is created here, idempotently, so a
 * test database and the live one cannot drift apart.
 */
export function initSchema(d: Database.Database) {
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

    -- Connection to the Things sidecar. Lives server-side rather than in the
    -- client settings blob for two reasons: the API key must never be sent to
    -- a browser, and every device has to see the same connection.
    CREATE TABLE IF NOT EXISTS things_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      api_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO things_config (id, updated_at) VALUES (1, 0);

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

  // Things: the account sesh signs in as, when talking to Things Cloud
  // directly. The password is stored encrypted — see lib/things-config.
  ensureColumn(d, 'things_config', 'email', "email TEXT NOT NULL DEFAULT ''")
  ensureColumn(d, 'things_config', 'password_enc', "password_enc TEXT NOT NULL DEFAULT ''")
  ensureColumn(d, 'things_config', 'history_key', "history_key TEXT NOT NULL DEFAULT ''")

  /*
   * Local replay of the Things event log. Things Cloud sends history rather
   * than state, so the current shape of a task is whatever is left after
   * applying every item about it — materialised here so a page load is a
   * query, not a replay. See lib/things-store.
   */
  d.exec(`
    CREATE TABLE IF NOT EXISTS things_tasks (
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
    CREATE INDEX IF NOT EXISTS idx_things_tasks_schedule ON things_tasks(schedule);
    CREATE INDEX IF NOT EXISTS idx_things_tasks_status ON things_tasks(status);

    CREATE TABLE IF NOT EXISTS things_areas (
      uuid TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS things_tags (
      uuid TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS things_task_tags (
      task_uuid TEXT NOT NULL,
      tag_uuid TEXT NOT NULL,
      PRIMARY KEY (task_uuid, tag_uuid)
    );

    CREATE TABLE IF NOT EXISTS things_sync (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      history_key TEXT NOT NULL DEFAULT '',
      server_index INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO things_sync (id) VALUES (1);
  `)

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
  initSyncSchema(d)
}

/** Epoch milliseconds, as SQL — the unit every timestamp in this schema is in. */
const NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"

/**
 * The columns an offline client needs to sync against, and the triggers that
 * maintain them.
 *
 * Two different clocks, because they answer different questions:
 *
 *  - `seq` is a single monotonic counter across the database, handed out by
 *    `sync_meta`. It is what a client pulls against ("everything after 1240"),
 *    and it is a counter rather than a timestamp because two writes in the
 *    same millisecond are ordinary and a client's clock is not to be trusted.
 *  - `updated_at` is epoch ms and decides *conflicts*: the later edit of the
 *    same field wins.
 *
 * They are maintained by trigger rather than by each route because the writes
 * that must be tracked are scattered — the category rename cascades into
 * `sessions`, the timer's completion inserts one, the calendar writer stamps
 * event ids onto rows nobody edited. A route added later gets this for free;
 * one that forgets would otherwise leave a phone silently stale.
 *
 * The distinction the `CASE` draws matters: a write that only touches
 * bookkeeping columns (`google_event_id`, `is_synced`) advances `seq`, so
 * clients still learn about it, but leaves `updated_at` where it was. Bumping
 * it would date a calendar sync as a fresh edit and let it beat — and discard —
 * a genuine edit made on a phone ten seconds earlier while it was offline.
 */
function initSyncSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      seq INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO sync_meta (id, seq) VALUES (1, 0);

    /*
     * Applied client operations, keyed by the id the client generated. A phone
     * that pushes an op and loses the response replays it; without this the
     * replay would write the session a second time, or add the same minutes
     * again. The stored result is replayed back instead.
     */
    CREATE TABLE IF NOT EXISTS sync_ops (
      op_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_ops_created_at ON sync_ops(created_at);

    /* The same idea for the task routes, which are commands to Todoist and
     * Things rather than rows: see lib/idempotency. */
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      status INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys(created_at);
  `)

  for (const table of ['sessions', 'categories'] as const) {
    ensureColumn(d, table, 'seq', 'seq INTEGER NOT NULL DEFAULT 0')
    ensureColumn(d, table, 'updated_at', 'updated_at INTEGER NOT NULL DEFAULT 0')
    ensureColumn(d, table, 'deleted_at', 'deleted_at INTEGER')
    d.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_seq ON ${table}(seq)`)
  }
  ensureColumn(d, 'settings', 'seq', 'seq INTEGER NOT NULL DEFAULT 0')
  ensureColumn(d, 'settings', 'updated_at', 'updated_at INTEGER NOT NULL DEFAULT 0')
  d.exec('CREATE INDEX IF NOT EXISTS idx_settings_seq ON settings(seq)')

  // Which device is running the timer, so a client can tell "mine, still
  // going" from "started on the laptop" instead of silently adopting it.
  ensureColumn(d, 'timer_state', 'device_id', "device_id TEXT NOT NULL DEFAULT ''")

  /*
   * Dropped and recreated rather than IF NOT EXISTS: a trigger is code, and an
   * edit to the definitions below has to reach a database that already has the
   * old one, which IF NOT EXISTS would quietly decline to do.
   */
  const trackedTables: Array<{ table: string; userFields: string }> = [
    {
      table: 'sessions',
      userFields: `NEW.intention <> OLD.intention OR NEW.category <> OLD.category
        OR NEW.notes <> OLD.notes OR NEW.rating <> OLD.rating
        OR COALESCE(NEW.todoist_task_id, '') <> COALESCE(OLD.todoist_task_id, '')
        OR COALESCE(NEW.deleted_at, 0) <> COALESCE(OLD.deleted_at, 0)`,
    },
    {
      table: 'categories',
      userFields: `NEW.name <> OLD.name OR NEW.label <> OLD.label OR NEW.color <> OLD.color
        OR NEW.sort_order <> OLD.sort_order OR NEW.is_default <> OLD.is_default
        OR COALESCE(NEW.deleted_at, 0) <> COALESCE(OLD.deleted_at, 0)`,
    },
    { table: 'settings', userFields: 'NEW.value <> OLD.value' },
  ]

  for (const { table, userFields } of trackedTables) {
    d.exec(`
      DROP TRIGGER IF EXISTS trg_${table}_seq_ins;
      DROP TRIGGER IF EXISTS trg_${table}_seq_upd;

      CREATE TRIGGER trg_${table}_seq_ins AFTER INSERT ON ${table}
      BEGIN
        UPDATE sync_meta SET seq = seq + 1 WHERE id = 1;
        UPDATE ${table} SET
          seq = (SELECT seq FROM sync_meta WHERE id = 1),
          updated_at = CASE WHEN NEW.updated_at > 0 THEN NEW.updated_at ELSE ${NOW_MS} END
        WHERE rowid = NEW.rowid;
      END;

      CREATE TRIGGER trg_${table}_seq_upd AFTER UPDATE ON ${table}
      -- The trigger's own write below changes seq, so this guard keeps it from
      -- re-entering if recursive triggers are ever switched on.
      WHEN NEW.seq = OLD.seq
      BEGIN
        UPDATE sync_meta SET seq = seq + 1 WHERE id = 1;
        UPDATE ${table} SET
          seq = (SELECT seq FROM sync_meta WHERE id = 1),
          updated_at = CASE
            WHEN NEW.updated_at <> OLD.updated_at THEN NEW.updated_at
            WHEN ${userFields} THEN ${NOW_MS}
            ELSE OLD.updated_at
          END
        WHERE rowid = NEW.rowid;
      END;
    `)
  }

  /*
   * Backfill, once. `seq = 0` means a row predates this schema (or was seeded
   * above), and the update itself is what assigns the seq, through the trigger.
   * A session's best-known edit time is when it ended; there is no better
   * record, and it keeps freshly-synced history in a plausible order.
   */
  d.exec(`
    UPDATE sessions SET updated_at = MAX(ended_at, started_at, 1) WHERE seq = 0;
    UPDATE categories SET updated_at = ${NOW_MS} WHERE seq = 0;
    UPDATE settings SET updated_at = ${NOW_MS} WHERE seq = 0;
  `)
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
