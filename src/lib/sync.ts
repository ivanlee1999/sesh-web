import type Database from 'better-sqlite3'
import { slugifyLabel } from '@/lib/categories'
import {
  type CategoryJson,
  type CategoryRow,
  deleteCategory,
  findCategoryById,
  findCategoryByName,
  freeCategorySlug,
  liveSessionCountForCategory,
  renameCategory,
  rowToCategoryJson,
} from '@/lib/categories-server'
import type { CompletedSession } from '@/lib/session-complete'
import { resolveTimerCategory, writeTimerState } from '@/lib/timer-state'

/**
 * The replication protocol the iOS app speaks.
 *
 * One exchange: the client pushes everything it did while it was away, then
 * pulls everything that happened without it, and both halves commit against a
 * cursor it can resume from. The shape is deliberately small — this is a
 * single-user app, so the hard part is not merging two people's intentions but
 * making sure a phone in a tunnel loses nothing and repeats nothing.
 *
 * Three rules hold the whole thing up:
 *
 *  - **Operations are named by the client.** Every op carries an id the client
 *    generated, and `sync_ops` remembers what happened to it. A reply lost to a
 *    dropped connection is therefore safe to ask for again: the second attempt
 *    returns the first attempt's answer instead of doing the work twice.
 *  - **`seq` orders the world.** A single counter, so a client's cursor is a
 *    precise place in a queue rather than a guess about clocks.
 *  - **`updated_at` settles disputes, a row at a time.** The later edit wins the
 *    whole editable set — title, category, notes, rating, task links — not
 *    field by field. That is a deliberate simplification and it has a cost: a
 *    note added on a phone at 10:00 and a rating given on the laptop at 10:01
 *    will not merge, and the note is dropped when the phone syncs. Doing
 *    better needs a timestamp per field, which is worth having and is not here
 *    yet. Timings are outside the argument entirely: they are set by whoever
 *    ran the session and never revised.
 */

export type OpStatus = 'applied' | 'duplicate' | 'stale' | 'rejected'

export interface SyncOp {
  opId: string
  kind: string
  payload?: Record<string, unknown>
}

export interface OpResult {
  opId: string
  status: OpStatus
  error?: string
  /**
   * The category the server actually used, when it differs from the one asked
   * for — a slug renamed or deleted while the client was offline. The client
   * repoints its local rows at this rather than guessing.
   */
  category?: CategoryJson
  /** Why a category could not be deleted. */
  sessionCount?: number
}

export interface SessionJson {
  id: string
  intention: string
  category: string
  type: string
  targetMs: number
  actualMs: number
  overflowMs: number
  startedAt: number
  endedAt: number
  notes: string
  rating: number
  todoistTaskId: string | null
  updatedAt: number
  deletedAt: number | null
}

export interface SettingJson {
  key: string
  value: unknown
  updatedAt: number
}

export interface PullResult {
  changes: {
    sessions: SessionJson[]
    categories: Array<CategoryJson & { updatedAt: number; deletedAt: number | null }>
    settings: SettingJson[]
  }
  cursor: number
  hasMore: boolean
}

interface SessionRow {
  id: string
  intention: string
  category: string
  type: string
  target_ms: number
  actual_ms: number
  overflow_ms: number
  started_at: number
  ended_at: number
  notes: string
  rating: number
  todoist_task_id: string | null
  google_event_id: string
  is_synced: number
  seq: number
  updated_at: number
  deleted_at: number | null
}

const MAX_PULL_LIMIT = 1000
const DEFAULT_PULL_LIMIT = 500
/** Long enough that no realistic offline stretch outlives its own replay guard. */
const OP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function sessionRowToJson(row: SessionRow): SessionJson {
  return {
    id: row.id,
    intention: row.intention,
    category: row.category,
    type: row.type,
    targetMs: row.target_ms,
    actualMs: row.actual_ms,
    overflowMs: row.overflow_ms,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    rating: row.rating ?? 0,
    todoistTaskId: row.todoist_task_id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

/**
 * Every number in this schema is a whole one — milliseconds, counts, ratings —
 * and it is rounded here rather than trusted.
 *
 * A client that sends `Date.now()` through a float path can hand over
 * `1789517179528.8936`. SQLite has no opinion about that: the column says
 * INTEGER, but the value is not losslessly an integer, so it is kept as a
 * REAL — and from then on *every* client pulling that row receives a
 * fractional timestamp. A stricter client then refuses to decode the page it
 * arrives in, losing every row beside it, not just the odd one.
 *
 * One client's sloppiness must not become everyone's data.
 */
function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function clampRating(value: unknown): number {
  return Math.max(0, Math.min(5, Math.round(Number(value)) || 0))
}

/** The client's stated edit time, or now if it did not say. */
function stampOf(payload: Record<string, unknown> | undefined, field = 'updatedAt'): number {
  const given = num(payload?.[field], 0)
  return given > 0 ? given : Date.now()
}

// ── Pull ────────────────────────────────────────────────────────────────

/**
 * Everything that changed after `cursor`, oldest first.
 *
 * Each table is read one row past the limit so the merge below can tell a page
 * that ends from one that is merely cut off; the cursor then advances only as
 * far as the rows actually handed over, so nothing between the last row sent
 * and the true head can slip through unseen.
 */
export function pullChanges(db: Database.Database, cursor: number, limit = DEFAULT_PULL_LIMIT): PullResult {
  const take = Math.max(1, Math.min(MAX_PULL_LIMIT, Math.floor(limit) || DEFAULT_PULL_LIMIT))
  const from = Math.max(0, Math.floor(cursor) || 0)

  const sessions = db.prepare(
    'SELECT * FROM sessions WHERE seq > ? ORDER BY seq LIMIT ?',
  ).all(from, take + 1) as SessionRow[]
  const categories = db.prepare(
    'SELECT * FROM categories WHERE seq > ? ORDER BY seq LIMIT ?',
  ).all(from, take + 1) as CategoryRow[]
  const settings = db.prepare(
    'SELECT key, value, seq, updated_at FROM settings WHERE seq > ? ORDER BY seq LIMIT ?',
  ).all(from, take + 1) as Array<{ key: string; value: string; seq: number; updated_at: number }>

  type Entry =
    | { seq: number; table: 'sessions'; row: SessionRow }
    | { seq: number; table: 'categories'; row: CategoryRow }
    | { seq: number; table: 'settings'; row: { key: string; value: string; seq: number; updated_at: number } }

  const merged: Entry[] = [
    ...sessions.map(row => ({ seq: row.seq, table: 'sessions' as const, row })),
    ...categories.map(row => ({ seq: row.seq, table: 'categories' as const, row })),
    ...settings.map(row => ({ seq: row.seq, table: 'settings' as const, row })),
  ].sort((a, b) => a.seq - b.seq)

  const page = merged.slice(0, take)
  const hasMore = merged.length > page.length
  const nextCursor = page.length > 0 ? page[page.length - 1].seq : from

  const result: PullResult = {
    changes: { sessions: [], categories: [], settings: [] },
    cursor: nextCursor,
    hasMore,
  }

  for (const entry of page) {
    if (entry.table === 'sessions') {
      result.changes.sessions.push(sessionRowToJson(entry.row))
    } else if (entry.table === 'categories') {
      result.changes.categories.push({
        ...rowToCategoryJson(entry.row),
        updatedAt: entry.row.updated_at,
        deletedAt: entry.row.deleted_at,
      })
    } else {
      let value: unknown = entry.row.value
      try { value = JSON.parse(entry.row.value) } catch { /* stored raw by an older writer */ }
      result.changes.settings.push({ key: entry.row.key, value, updatedAt: entry.row.updated_at })
    }
  }

  return result
}

// ── Push ────────────────────────────────────────────────────────────────

/**
 * Work that must happen after the row is safely committed: calendar entries,
 * announcements, minutes written back to Todoist and Things. Collected during
 * the transaction and run once it has landed, because these are calls to other
 * people's servers and none of them may hold a database write open — nor undo
 * one by failing.
 */
export interface PendingEffect {
  kind: 'completed' | 'deleted'
  session: CompletedSession
  isNew: boolean
}

export interface ApplyResult {
  results: OpResult[]
  effects: PendingEffect[]
}

function recordOp(db: Database.Database, op: SyncOp, deviceId: string, result: OpResult): void {
  db.prepare(
    'INSERT OR REPLACE INTO sync_ops (op_id, device_id, kind, result, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(op.opId, deviceId, op.kind, JSON.stringify(result), Date.now())
}

function priorResult(db: Database.Database, opId: string): OpResult | null {
  const row = db.prepare('SELECT result FROM sync_ops WHERE op_id = ?').get(opId) as { result: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.result) as OpResult
  } catch {
    return null
  }
}

export function pruneSyncOps(db: Database.Database): void {
  db.prepare('DELETE FROM sync_ops WHERE created_at < ?').run(Date.now() - OP_RETENTION_MS)
}

/**
 * Apply one batch of client operations, in the order the client sent them.
 *
 * Each op is its own transaction, along with the record of having applied it,
 * so a batch that fails halfway leaves every op before the failure durably
 * done and every op after it untouched — the client simply sends the rest
 * again.
 */
export function applyOps(db: Database.Database, ops: SyncOp[], deviceId: string): ApplyResult {
  const results: OpResult[] = []
  const effects: PendingEffect[] = []

  for (const op of ops) {
    if (!op || typeof op.opId !== 'string' || !op.opId) {
      results.push({ opId: str(op?.opId, ''), status: 'rejected', error: 'Missing opId' })
      continue
    }

    try {
      /*
       * The replay check belongs inside the transaction, not before it.
       * Checking first and writing afterwards leaves a window: the same op
       * arriving twice at once — a client retrying while its first attempt is
       * still in flight — could pass the check twice and be applied twice,
       * which for a completion means two calendar events and two helpings of
       * minutes written back to a task.
       */
      const applied = db.transaction(() => {
        const seen = priorResult(db, op.opId)
        if (seen) {
          return { result: { ...seen, opId: op.opId, status: 'duplicate' as OpStatus }, effect: undefined }
        }
        const outcome = applyOne(db, op, deviceId)
        recordOp(db, op, deviceId, outcome.result)
        return outcome
      })()

      results.push(applied.result)
      // A replayed op has already had its effects; running them again is the
      // very thing the record exists to prevent.
      if (applied.effect && applied.result.status !== 'duplicate') effects.push(applied.effect)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[sync] op ${op.kind} (${op.opId}) failed:`, message)
      // Deliberately not recorded: an op that threw has not been applied, and
      // the client should be free to try it again.
      results.push({ opId: op.opId, status: 'rejected', error: message })
    }
  }

  return { results, effects }
}

interface OneOutcome {
  result: OpResult
  effect?: PendingEffect
}

function applyOne(db: Database.Database, op: SyncOp, deviceId: string): OneOutcome {
  const payload = (op.payload ?? {}) as Record<string, unknown>

  switch (op.kind) {
    case 'session.complete': return applySessionComplete(db, op, payload)
    case 'session.upsert': return applySessionUpsert(db, op, payload)
    case 'session.delete': return applySessionDelete(db, op, payload)
    case 'category.upsert': return applyCategoryUpsert(db, op, payload)
    case 'category.delete': return applyCategoryDelete(db, op, payload)
    case 'settings.set': return applySettingsSet(db, op, payload)
    case 'timer.mirror':
      writeTimerState(db, payload, deviceId)
      return { result: { opId: op.opId, status: 'applied' } }
    default:
      return { result: { opId: op.opId, status: 'rejected', error: `Unknown op kind: ${op.kind}` } }
  }
}

function applySessionComplete(db: Database.Database, op: SyncOp, payload: Record<string, unknown>): OneOutcome {
  const id = str(payload.id)
  const startedAt = num(payload.startedAt)
  if (!id || !startedAt) {
    return { result: { opId: op.opId, status: 'rejected', error: 'A session needs an id and a start' } }
  }

  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  const updatedAt = stampOf(payload)

  // A category deleted or renamed while the phone was away must not take the
  // session down with it; it is filed under the fallback and the client is told
  // which, so both ends agree about where this hour went.
  const requested = str(payload.category)
  const resolved = resolveTimerCategory(db, requested)
  const remapped = resolved !== requested
    ? findCategoryByName(db, resolved)
    : undefined

  const endedAt = num(payload.endedAt, startedAt)
  const targetMs = num(payload.targetMs)
  const actualMs = num(payload.actualMs, Math.max(0, endedAt - startedAt))
  const session: CompletedSession = {
    id,
    intention: str(payload.intention),
    category: resolved,
    type: str(payload.type, 'focus'),
    targetMs,
    actualMs,
    overflowMs: num(payload.overflowMs, Math.max(0, actualMs - targetMs)),
    startedAt,
    endedAt,
    notes: str(payload.notes),
    rating: clampRating(payload.rating),
    todoistTaskId: payload.todoistTaskId == null ? null : str(payload.todoistTaskId),
    googleEventId: existing?.google_event_id ?? '',
    isSynced: existing?.is_synced === 1,
  }

  if (existing && existing.updated_at > updatedAt) {
    // The server's copy is newer. The completion itself is not in dispute —
    // only the fields a person edits — so the row stands as it is.
    return { result: { opId: op.opId, status: 'stale' } }
  }

  db.prepare(`
    INSERT INTO sessions
      (id, intention, category, type, target_ms, actual_ms, overflow_ms, started_at, ended_at, notes, rating, todoist_task_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      intention = excluded.intention,
      category = excluded.category,
      notes = excluded.notes,
      rating = excluded.rating,
      todoist_task_id = excluded.todoist_task_id,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run(
    session.id, session.intention, session.category, session.type,
    session.targetMs, session.actualMs, session.overflowMs,
    session.startedAt, session.endedAt, session.notes, session.rating ?? 0,
    session.todoistTaskId, updatedAt,
  )

  /*
   * If the shared timer is still showing this session, retire it. The phone ran
   * this one on its own clock and may never have mirrored it, so this is a
   * best-effort tidy-up rather than the compare-and-swap the timer route does —
   * the session row is the durable record either way.
   */
  db.prepare(`
    UPDATE timer_state
    SET phase = 'idle', intention = '', remaining_ms = target_ms, overflow_ms = 0,
        started_at = NULL, paused_at = NULL, updated_at = ?, todoist_task_id = NULL,
        notification_count = 0
    WHERE id = 1 AND started_at = ?
  `).run(Date.now(), startedAt)

  return {
    result: { opId: op.opId, status: 'applied', ...(remapped ? { category: rowToCategoryJson(remapped) } : {}) },
    effect: { kind: 'completed', session, isNew: !existing },
  }
}

function applySessionUpsert(db: Database.Database, op: SyncOp, payload: Record<string, unknown>): OneOutcome {
  const id = str(payload.id)
  if (!id) return { result: { opId: op.opId, status: 'rejected', error: 'A session edit needs an id' } }

  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  if (!existing) {
    return { result: { opId: op.opId, status: 'rejected', error: 'Session not found' } }
  }

  const updatedAt = stampOf(payload)
  if (existing.updated_at > updatedAt) {
    return { result: { opId: op.opId, status: 'stale' } }
  }

  const requested = payload.category === undefined ? existing.category : str(payload.category, existing.category)
  const resolved = resolveTimerCategory(db, requested)
  const remapped = resolved !== requested ? findCategoryByName(db, resolved) : undefined

  const intention = payload.intention === undefined ? existing.intention : str(payload.intention).trim()
  const notes = payload.notes === undefined ? existing.notes : str(payload.notes).trim()
  const rating = payload.rating === undefined ? existing.rating : clampRating(payload.rating)
  const taskRefs = payload.todoistTaskId === undefined
    ? existing.todoist_task_id
    : (payload.todoistTaskId == null ? null : str(payload.todoistTaskId))

  db.prepare(`
    UPDATE sessions
    SET intention = ?, category = ?, notes = ?, rating = ?, todoist_task_id = ?, updated_at = ?
    WHERE id = ?
  `).run(intention, resolved, notes, rating, taskRefs, updatedAt, id)

  const stored = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow

  return {
    result: { opId: op.opId, status: 'applied', ...(remapped ? { category: rowToCategoryJson(remapped) } : {}) },
    effect: {
      kind: 'completed',
      isNew: false,
      session: {
        id: stored.id,
        intention: stored.intention,
        category: stored.category,
        type: stored.type,
        targetMs: stored.target_ms,
        actualMs: stored.actual_ms,
        overflowMs: stored.overflow_ms,
        startedAt: stored.started_at,
        endedAt: stored.ended_at,
        notes: stored.notes,
        rating: stored.rating,
        todoistTaskId: stored.todoist_task_id,
        googleEventId: stored.google_event_id,
        isSynced: stored.is_synced === 1,
      },
    },
  }
}

function applySessionDelete(db: Database.Database, op: SyncOp, payload: Record<string, unknown>): OneOutcome {
  const id = str(payload.id)
  if (!id) return { result: { opId: op.opId, status: 'rejected', error: 'A deletion needs an id' } }

  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  if (!existing) {
    // Nothing to delete is the outcome the client wanted. Saying so beats an
    // error it would only have to learn to ignore.
    return { result: { opId: op.opId, status: 'applied' } }
  }
  if (existing.deleted_at !== null) {
    return { result: { opId: op.opId, status: 'applied' } }
  }

  const deletedAt = stampOf(payload, 'deletedAt')

  /*
   * A deletion is an edit like any other, and does not get to win by being a
   * deletion. Someone who renamed this session on the laptop after the phone
   * deleted it — while the phone was still offline — expressed the more recent
   * intention, and honouring the older delete would quietly take their session
   * away. This is the same rule `Merge.decide` applies on the client; the two
   * ends have to agree or a row would flip depending on who spoke last.
   */
  if (existing.updated_at > deletedAt) {
    return { result: { opId: op.opId, status: 'stale' } }
  }

  db.prepare('UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(deletedAt, deletedAt, id)

  return {
    result: { opId: op.opId, status: 'applied' },
    effect: existing.google_event_id
      ? {
        kind: 'deleted',
        isNew: false,
        session: {
          id: existing.id,
          intention: existing.intention,
          category: existing.category,
          type: existing.type,
          targetMs: existing.target_ms,
          actualMs: existing.actual_ms,
          overflowMs: existing.overflow_ms,
          startedAt: existing.started_at,
          endedAt: existing.ended_at,
          notes: existing.notes,
          rating: existing.rating,
          todoistTaskId: existing.todoist_task_id,
          googleEventId: existing.google_event_id,
          isSynced: existing.is_synced === 1,
        },
      }
      : undefined,
  }
}

function applyCategoryUpsert(db: Database.Database, op: SyncOp, payload: Record<string, unknown>): OneOutcome {
  const id = str(payload.id)
  const label = str(payload.label).trim()
  if (!id || !label) {
    return { result: { opId: op.opId, status: 'rejected', error: 'A category needs an id and a label' } }
  }

  const name = str(payload.name) || slugifyLabel(label)
  if (!name) return { result: { opId: op.opId, status: 'rejected', error: 'Invalid label' } }

  const color = str(payload.color, '#6b7280')
  const updatedAt = stampOf(payload)
  const existing = findCategoryById(db, id, true)

  /*
   * Another category already answers to this slug. Sessions are filed by slug,
   * so two rows cannot share one — and the client is told which row won, so it
   * can point its own copy at that id instead of retrying forever.
   */
  const collision = findCategoryByName(db, name, id)
  if (collision) {
    return {
      result: {
        opId: op.opId,
        status: 'rejected',
        error: 'A category with this name already exists',
        category: rowToCategoryJson(collision),
      },
    }
  }

  // Nothing live holds this slug, but a tombstone might, and the constraint
  // does not care that it is invisible.
  freeCategorySlug(db, name, id)

  if (existing) {
    if (existing.updated_at > updatedAt) {
      return { result: { opId: op.opId, status: 'stale' } }
    }
    renameCategory(db, existing, {
      name,
      label,
      color,
      sortOrder: payload.sortOrder === undefined ? undefined : num(payload.sortOrder),
      isDefault: payload.isDefault === undefined ? undefined : Boolean(payload.isDefault),
      updatedAt,
    })
    const stored = findCategoryById(db, id, true) as CategoryRow
    return { result: { opId: op.opId, status: 'applied', category: rowToCategoryJson(stored) } }
  }

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM categories').get() as { m: number | null }
  const sortOrder = payload.sortOrder === undefined ? (maxOrder.m ?? -1) + 1 : num(payload.sortOrder)
  db.prepare(`
    INSERT INTO categories (id, name, label, color, sort_order, is_default, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, label, color, sortOrder, payload.isDefault ? 1 : 0, updatedAt)

  const stored = findCategoryById(db, id, true) as CategoryRow
  return { result: { opId: op.opId, status: 'applied', category: rowToCategoryJson(stored) } }
}

function applyCategoryDelete(db: Database.Database, op: SyncOp, payload: Record<string, unknown>): OneOutcome {
  const id = str(payload.id)
  if (!id) return { result: { opId: op.opId, status: 'rejected', error: 'A deletion needs an id' } }

  const existing = findCategoryById(db, id)
  if (!existing) return { result: { opId: op.opId, status: 'applied' } }

  // Same rule as a session deletion: a rename or recolour that happened after
  // this delete was queued is the newer intention and keeps the category.
  const deletedAt = stampOf(payload, 'deletedAt')
  if (existing.updated_at > deletedAt) {
    return { result: { opId: op.opId, status: 'stale' } }
  }

  const sessionCount = liveSessionCountForCategory(db, existing.name)
  if (sessionCount > 0) {
    return {
      result: {
        opId: op.opId,
        status: 'rejected',
        error: 'Category is in use',
        sessionCount,
        category: rowToCategoryJson(existing),
      },
    }
  }

  deleteCategory(db, existing)
  return { result: { opId: op.opId, status: 'applied' } }
}

function applySettingsSet(db: Database.Database, op: SyncOp, payload: Record<string, unknown>): OneOutcome {
  const key = str(payload.key)
  if (!key) return { result: { opId: op.opId, status: 'rejected', error: 'A setting needs a key' } }

  const updatedAt = stampOf(payload)
  const existing = db.prepare('SELECT updated_at FROM settings WHERE key = ?').get(key) as { updated_at: number } | undefined
  if (existing && existing.updated_at > updatedAt) {
    return { result: { opId: op.opId, status: 'stale' } }
  }

  const value = JSON.stringify(payload.value ?? null)
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, updatedAt)

  return { result: { opId: op.opId, status: 'applied' } }
}
