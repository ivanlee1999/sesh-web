import 'server-only'
import type Database from 'better-sqlite3'
import { getDb } from './server-db'
import { dayStartUtcSeconds, todayKey } from './task-dates'
import {
  ACTION_DELETED,
  AREA_KINDS,
  TAG_KINDS,
  TASK_KINDS,
  decodeNote,
  fetchItems,
  type ThingsCredentials,
  type ThingsItem,
} from './things-cloud'

/**
 * Local replay of the Things event log.
 *
 * Things sends history, not state: the current shape of a task is whatever is
 * left after applying every item that mentions it. Replaying thousands of items
 * per request would be far too slow, so the result is materialised here and the
 * stream position is remembered — later syncs only fetch what is new.
 */

/** Wire fields, decoded. See things-cloud for where these names come from. */
interface TaskPayload {
  tt?: string          // title
  nt?: unknown         // note
  ss?: number          // status: 0 open, 2 cancelled, 3 done
  st?: number          // schedule: 0 inbox, 1 anytime, 2 someday
  sr?: number | null   // scheduled date, unix seconds
  dd?: number | null   // deadline
  tp?: number          // 0 to-do, 1 project, 2 heading
  tr?: boolean         // in trash
  ar?: string[]        // area ids
  pr?: string[]        // parent project ids
  tg?: string[]        // tag ids
}

export interface StoredThingsTask {
  uuid: string
  title: string
  note: string
  status: number
  schedule: number
  scheduledAt: number | null
  deadlineAt: number | null
  type: number
  inTrash: number
  deleted: number
  areaUuid: string | null
  projectUuid: string | null
}

interface SyncRow {
  history_key: string
  server_index: number
  synced_at: number
}

function readSyncRow(): SyncRow {
  return getDb()
    .prepare('SELECT history_key, server_index, synced_at FROM things_sync WHERE id = 1')
    .get() as SyncRow ?? { history_key: '', server_index: 0, synced_at: 0 }
}

/** A different account means the replayed data belongs to someone else. */
function resetStore() {
  const db = getDb()
  db.exec(`
    DELETE FROM things_tasks;
    DELETE FROM things_areas;
    DELETE FROM things_tags;
    DELETE FROM things_task_tags;
  `)
}

/**
 * Compiling a statement is not free, and a first sync replays tens of thousands
 * of items — preparing inside the loop was a large share of the time the whole
 * server spent blocked. Cached per database so tests, which swap in their own,
 * are not handed statements belonging to a closed connection.
 */
const statementCache = new WeakMap<Database.Database, Map<string, Database.Statement>>()

function stmt(db: Database.Database, sql: string): Database.Statement {
  let forDb = statementCache.get(db)
  if (!forDb) {
    forDb = new Map()
    statementCache.set(db, forDb)
  }
  let prepared = forDb.get(sql)
  if (!prepared) {
    prepared = db.prepare(sql)
    forDb.set(sql, prepared)
  }
  return prepared
}

const UPSERT_TASK = `
  INSERT INTO things_tasks (uuid, title, note, status, schedule, scheduled_at, deadline_at, type, in_trash, deleted, area_uuid, project_uuid)
  VALUES (
    @uuid,
    -- A create can omit any field; the NOT NULL columns need a default here,
    -- because the COALESCE below only guards the update branch.
    COALESCE(@title, ''), COALESCE(@note, ''), COALESCE(@status, 0), COALESCE(@schedule, 0),
    @scheduledAt, @deadlineAt, COALESCE(@type, 0), COALESCE(@inTrash, 0), 0,
    @areaUuid, @projectUuid
  )
  ON CONFLICT(uuid) DO UPDATE SET
    title = COALESCE(@title, title),
    note = COALESCE(@note, note),
    status = COALESCE(@status, status),
    schedule = COALESCE(@schedule, schedule),
    scheduled_at = CASE WHEN @scheduledSet = 1 THEN @scheduledAt ELSE scheduled_at END,
    deadline_at = CASE WHEN @deadlineSet = 1 THEN @deadlineAt ELSE deadline_at END,
    type = COALESCE(@type, type),
    in_trash = COALESCE(@inTrash, in_trash),
    area_uuid = CASE WHEN @areaSet = 1 THEN @areaUuid ELSE area_uuid END,
    project_uuid = CASE WHEN @projectSet = 1 THEN @projectUuid ELSE project_uuid END,
    deleted = 0
`

function applyTask(db: Database.Database, item: ThingsItem) {
  if (item.action === ACTION_DELETED) {
    stmt(db, 'UPDATE things_tasks SET deleted = 1 WHERE uuid = ?').run(item.uuid)
    return
  }
  const p = item.payload as TaskPayload
  // Only read the row back when a note actually needs merging onto it; the
  // lookup is per item, and most items do not touch the note.
  const existing = p.nt === undefined
    ? undefined
    : stmt(db, 'SELECT note FROM things_tasks WHERE uuid = ?').get(item.uuid) as { note: string } | undefined

  // Every field is optional on a modify: an absent key means "unchanged", which
  // is why this merges onto the current row rather than replacing it.
  stmt(db, UPSERT_TASK).run({
    uuid: item.uuid,
    title: p.tt ?? null,
    note: p.nt === undefined ? null : decodeNote(p.nt, existing?.note ?? ''),
    status: p.ss ?? null,
    schedule: p.st ?? null,
    scheduledAt: p.sr ?? null,
    scheduledSet: p.sr === undefined ? 0 : 1,
    deadlineAt: p.dd ?? null,
    deadlineSet: p.dd === undefined ? 0 : 1,
    type: p.tp ?? null,
    inTrash: p.tr === undefined ? null : (p.tr ? 1 : 0),
    areaUuid: p.ar?.[0] ?? null,
    areaSet: p.ar === undefined ? 0 : 1,
    projectUuid: p.pr?.[0] ?? null,
    projectSet: p.pr === undefined ? 0 : 1,
  })

  if (p.tg !== undefined) {
    stmt(db, 'DELETE FROM things_task_tags WHERE task_uuid = ?').run(item.uuid)
    const link = stmt(db, 'INSERT OR IGNORE INTO things_task_tags (task_uuid, tag_uuid) VALUES (?, ?)')
    for (const tag of p.tg) link.run(item.uuid, tag)
  }
}

function applyNamed(db: Database.Database, table: 'things_areas' | 'things_tags', item: ThingsItem) {
  if (item.action === ACTION_DELETED) {
    stmt(db, `UPDATE ${table} SET deleted = 1 WHERE uuid = ?`).run(item.uuid)
    return
  }
  const title = (item.payload as { tt?: string }).tt
  stmt(db, `
    INSERT INTO ${table} (uuid, title, deleted) VALUES (?, ?, 0)
    ON CONFLICT(uuid) DO UPDATE SET title = COALESCE(?, title), deleted = 0
  `).run(item.uuid, title ?? '', title ?? null)
}

export function applyItems(items: ThingsItem[]) {
  const db = getDb()
  db.transaction(() => {
    for (const item of items) {
      if (TASK_KINDS.has(item.kind)) applyTask(db, item)
      else if (AREA_KINDS.has(item.kind)) applyNamed(db, 'things_areas', item)
      else if (TAG_KINDS.has(item.kind)) applyNamed(db, 'things_tags', item)
      // Settings, checklists and tombstones carry nothing sesh shows.
    }
  })()
}

/**
 * Replaying a whole batch in one transaction blocks the event loop for as long
 * as it takes — and on a first sync that is long enough for every other request
 * in flight, including unrelated ones, to time out at the proxy. Slicing it and
 * yielding between slices keeps each blocking span short. Replay is an upsert,
 * so a crash part-way through just re-applies on the next pass.
 */
const APPLY_CHUNK = 400

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

async function applyItemsYielding(items: ThingsItem[]) {
  for (let i = 0; i < items.length; i += APPLY_CHUNK) {
    applyItems(items.slice(i, i + APPLY_CHUNK))
    await yieldToEventLoop()
  }
}

export interface SyncOutcome {
  fetched: number
  serverIndex: number
  caughtUp: boolean
}

export interface SyncLimits {
  /** Hard cap on pages fetched in one call. */
  maxBatches?: number
  /**
   * Stop starting new batches once this much time has passed. Progress is
   * always persisted, so the next call resumes where this one stopped.
   */
  budgetMs?: number
}

/**
 * Pulls new items and replays them.
 *
 * Both limits exist because the very first sync of a long-standing account can
 * be tens of thousands of items: it cannot be allowed to run for the minutes
 * that would take while a request is held open on it. Whatever it manages
 * within the budget is committed, `caughtUp` says whether there is more, and
 * the caller decides whether to keep going in the background.
 */
export async function syncThings(
  creds: ThingsCredentials,
  historyKey: string,
  limits: SyncLimits = {},
): Promise<SyncOutcome> {
  const { maxBatches = 200, budgetMs = 60_000 } = limits
  const startedAt = Date.now()
  const db = getDb()
  const state = readSyncRow()

  if (state.history_key && state.history_key !== historyKey) {
    resetStore()
    db.prepare('UPDATE things_sync SET history_key = ?, server_index = 0 WHERE id = 1').run(historyKey)
  } else if (!state.history_key) {
    db.prepare('UPDATE things_sync SET history_key = ? WHERE id = 1').run(historyKey)
  }

  let index = state.history_key === historyKey ? state.server_index : 0
  let fetched = 0
  let caughtUp = false

  for (let batch = 0; batch < maxBatches; batch += 1) {
    // Checked before fetching, not after: a batch already under way should
    // finish and be committed rather than be thrown away at the boundary.
    if (batch > 0 && Date.now() - startedAt >= budgetMs) break

    const { items, currentItemIndex } = await fetchItems(creds, historyKey, index)
    if (items.length === 0) {
      caughtUp = true
      index = Math.max(index, currentItemIndex)
      break
    }
    await applyItemsYielding(items)
    fetched += items.length
    index += items.length
    db.prepare('UPDATE things_sync SET server_index = ?, synced_at = ? WHERE id = 1')
      .run(index, Date.now())
    if (index >= currentItemIndex) {
      caughtUp = true
      break
    }
  }

  db.prepare('UPDATE things_sync SET server_index = ?, synced_at = ? WHERE id = 1').run(index, Date.now())
  return { fetched, serverIndex: index, caughtUp }
}

export function thingsSyncState() {
  const row = readSyncRow()
  return { historyKey: row.history_key, serverIndex: row.server_index, syncedAt: row.synced_at }
}

export type ThingsView = 'today' | 'inbox' | 'anytime' | 'upcoming' | 'someday'

/**
 * Things' views are derived, not stored: `st` says which list a to-do belongs
 * to and the scheduled date decides whether it has surfaced yet.
 *
 * `@today` is the Unix second at which the viewer's current day begins in UTC.
 * Scheduled dates are floating calendar days on the wire, written as UTC
 * midnight, so comparing two UTC day boundaries is exact — and, unlike an
 * end-of-day built from the server's own clock, it puts the day break where the
 * person reading the list actually experiences it.
 */
function viewClause(view: ThingsView): string {
  // Columns must be qualified: the query self-joins things_tasks to resolve a
  // task's parent project, so a bare `schedule` is ambiguous.
  switch (view) {
    case 'inbox': return 't.schedule = 0'
    case 'today': return 't.schedule = 1 AND t.scheduled_at IS NOT NULL AND t.scheduled_at <= @today'
    case 'anytime': return 't.schedule = 1 AND t.scheduled_at IS NULL'
    case 'upcoming': return '(t.schedule = 2 AND t.scheduled_at IS NOT NULL) OR (t.schedule = 1 AND t.scheduled_at > @today)'
    case 'someday': return 't.schedule = 2 AND t.scheduled_at IS NULL'
  }
}

function serverDayStart(): number {
  return dayStartUtcSeconds(todayKey())
}

export interface ThingsTaskView extends StoredThingsTask {
  areaTitle: string | null
  projectTitle: string | null
  tags: string[]
}

/**
 * @param todayStart Unix second at which the viewer's current day starts in
 *   UTC — see `dayStartUtcSeconds`. Defaults to the server's own day only so
 *   tests and scripts can call this without a request context.
 */
export function readTasks(views: ThingsView[], todayStart = serverDayStart()): ThingsTaskView[] {
  const db = getDb()
  const today = todayStart
  const seen = new Set<string>()
  const out: ThingsTaskView[] = []

  for (const view of views) {
    const rows = db.prepare(`
      SELECT t.*, a.title AS area_title, p.title AS project_title
      FROM things_tasks t
      LEFT JOIN things_areas a ON a.uuid = t.area_uuid
      LEFT JOIN things_tasks p ON p.uuid = t.project_uuid
      WHERE t.deleted = 0 AND t.in_trash = 0 AND t.status = 0 AND t.type = 0
        AND (${viewClause(view)})
      ORDER BY t.scheduled_at IS NULL, t.scheduled_at
    `).all({ today }) as Array<Record<string, unknown>>

    for (const row of rows) {
      const uuid = String(row.uuid)
      if (seen.has(uuid)) continue
      seen.add(uuid)
      const tags = db.prepare(`
        SELECT g.title FROM things_task_tags tt
        JOIN things_tags g ON g.uuid = tt.tag_uuid AND g.deleted = 0
        WHERE tt.task_uuid = ?
      `).all(uuid) as Array<{ title: string }>

      out.push({
        uuid,
        title: String(row.title ?? ''),
        note: String(row.note ?? ''),
        status: Number(row.status ?? 0),
        schedule: Number(row.schedule ?? 0),
        scheduledAt: row.scheduled_at === null ? null : Number(row.scheduled_at),
        deadlineAt: row.deadline_at === null ? null : Number(row.deadline_at),
        type: Number(row.type ?? 0),
        inTrash: Number(row.in_trash ?? 0),
        deleted: Number(row.deleted ?? 0),
        areaUuid: (row.area_uuid as string) ?? null,
        projectUuid: (row.project_uuid as string) ?? null,
        areaTitle: (row.area_title as string) ?? null,
        projectTitle: (row.project_title as string) ?? null,
        tags: tags.map(t => t.title).filter(Boolean),
      })
    }
  }
  return out
}

export function readTaskNote(uuid: string): string {
  const row = getDb().prepare('SELECT note FROM things_tasks WHERE uuid = ?').get(uuid) as
    { note: string } | undefined
  return row?.note ?? ''
}

/** Reflects a local write immediately, so the UI doesn't wait for a re-sync. */
export function markTaskCompletedLocally(uuid: string) {
  getDb().prepare('UPDATE things_tasks SET status = ? WHERE uuid = ?').run(3, uuid)
}

export function setTaskNoteLocally(uuid: string, note: string) {
  getDb().prepare('UPDATE things_tasks SET note = ? WHERE uuid = ?').run(note, uuid)
}
