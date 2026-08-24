import 'server-only'
import type Database from 'better-sqlite3'
import { getDb } from './server-db'
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

function applyTask(db: Database.Database, item: ThingsItem) {
  if (item.action === ACTION_DELETED) {
    db.prepare('UPDATE things_tasks SET deleted = 1 WHERE uuid = ?').run(item.uuid)
    return
  }
  const p = item.payload as TaskPayload
  const existing = db.prepare('SELECT * FROM things_tasks WHERE uuid = ?').get(item.uuid) as
    { note: string } | undefined

  // Every field is optional on a modify: an absent key means "unchanged", which
  // is why this merges onto the current row rather than replacing it.
  db.prepare(`
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
  `).run({
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
    db.prepare('DELETE FROM things_task_tags WHERE task_uuid = ?').run(item.uuid)
    const link = db.prepare('INSERT OR IGNORE INTO things_task_tags (task_uuid, tag_uuid) VALUES (?, ?)')
    for (const tag of p.tg) link.run(item.uuid, tag)
  }
}

function applyNamed(db: Database.Database, table: 'things_areas' | 'things_tags', item: ThingsItem) {
  if (item.action === ACTION_DELETED) {
    db.prepare(`UPDATE ${table} SET deleted = 1 WHERE uuid = ?`).run(item.uuid)
    return
  }
  const title = (item.payload as { tt?: string }).tt
  db.prepare(`
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

export interface SyncOutcome {
  fetched: number
  serverIndex: number
  caughtUp: boolean
}

/**
 * Pulls new items and replays them.
 *
 * `maxBatches` bounds the work one HTTP request will do — the very first sync
 * of a long-standing account can be tens of thousands of items, and stalling a
 * page load on all of it is worse than catching up over a few requests.
 */
export async function syncThings(
  creds: ThingsCredentials,
  historyKey: string,
  maxBatches = 12,
): Promise<SyncOutcome> {
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
    const { items, currentItemIndex } = await fetchItems(creds, historyKey, index)
    if (items.length === 0) {
      caughtUp = true
      index = Math.max(index, currentItemIndex)
      break
    }
    applyItems(items)
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

function endOfToday(): number {
  const now = new Date()
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime() / 1000)
}

/**
 * Things' views are derived, not stored: `st` says which list a to-do belongs
 * to and the scheduled date decides whether it has surfaced yet.
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

export interface ThingsTaskView extends StoredThingsTask {
  areaTitle: string | null
  projectTitle: string | null
  tags: string[]
}

export function readTasks(views: ThingsView[]): ThingsTaskView[] {
  const db = getDb()
  const today = endOfToday()
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
