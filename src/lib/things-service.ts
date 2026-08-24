import 'server-only'
import { rememberHistoryKey, type ResolvedThingsConfig } from './things-config'
import {
  ThingsAuthError,
  commitItem,
  completedFields,
  noteFields,
  verifyAccount,
} from './things-cloud'
import {
  markTaskCompletedLocally,
  readTaskNote,
  readTasks,
  setTaskNoteLocally,
  syncThings,
  thingsSyncState,
  type ThingsView,
} from './things-store'
import {
  appendThingsFocusNote,
  completeThingsTask,
  listThingsTasks,
  verifyThings,
  type ThingsTaskRaw,
} from './things'

/**
 * One Things API for the routes, whichever way sesh is connected.
 *
 * The two connections answer the same questions but in different shapes — the
 * cloud one replays an event log locally, the sidecar one is a REST call — so
 * the branching lives here rather than in five route handlers.
 */

/** Re-sync at most this often; task lists are read far more than they change. */
const SYNC_INTERVAL_MS = 60_000

export interface ThingsHealth {
  reachable: boolean
  /** Set when the connection is configured but rejected — needs re-entering. */
  authFailed?: boolean
}

export async function checkThings(config: ResolvedThingsConfig): Promise<ThingsHealth> {
  if (config.mode !== 'cloud') {
    return { reachable: await verifyThings(config) }
  }
  try {
    const account = await verifyAccount(config.credentials)
    if (account.historyKey && account.historyKey !== config.historyKey) {
      rememberHistoryKey(account.historyKey)
    }
    return { reachable: true }
  } catch (err) {
    return { reachable: false, authFailed: err instanceof ThingsAuthError }
  }
}

async function historyKeyFor(config: Extract<ResolvedThingsConfig, { mode: 'cloud' }>): Promise<string> {
  if (config.historyKey) return config.historyKey
  const account = await verifyAccount(config.credentials)
  rememberHistoryKey(account.historyKey)
  return account.historyKey
}

/** Brings the local replay up to date, but only if it has gone stale. */
async function ensureSynced(config: Extract<ResolvedThingsConfig, { mode: 'cloud' }>, force = false) {
  const state = thingsSyncState()
  if (!force && state.syncedAt && Date.now() - state.syncedAt < SYNC_INTERVAL_MS) return
  const historyKey = await historyKeyFor(config)
  await syncThings(config.credentials, historyKey)
}

const VIEWS_BY_FILTER: Record<'today' | 'upcoming' | 'all', ThingsView[]> = {
  today: ['today'],
  upcoming: ['upcoming', 'anytime', 'inbox'],
  all: ['today', 'upcoming', 'anytime', 'inbox'],
}

/**
 * Tasks in the shape the API route already speaks, so both connections produce
 * identical JSON and the client never learns which one is in use.
 */
export async function loadThingsTasks(
  config: ResolvedThingsConfig,
  filter: 'today' | 'upcoming' | 'all',
): Promise<ThingsTaskRaw[]> {
  if (config.mode !== 'cloud') {
    return listThingsTasks(config, VIEWS_BY_FILTER[filter])
  }

  await ensureSynced(config)
  return readTasks(VIEWS_BY_FILTER[filter]).map(task => ({
    uuid: task.uuid,
    title: task.title,
    note: task.note,
    start_date: task.scheduledAt ? new Date(task.scheduledAt * 1000).toISOString().slice(0, 10) : null,
    deadline: task.deadlineAt ? new Date(task.deadlineAt * 1000).toISOString().slice(0, 10) : null,
    project_title: task.projectTitle,
    area_title: task.areaTitle,
    tags: task.tags,
    completed: false,
  }))
}

export async function completeThings(config: ResolvedThingsConfig, uuid: string): Promise<void> {
  if (config.mode !== 'cloud') {
    await completeThingsTask(config, uuid)
    return
  }
  const historyKey = await historyKeyFor(config)
  // ancestor-index is the writer's view of the stream head; sync first so the
  // commit is ordered against what the server actually has.
  await ensureSynced(config, true)
  await commitItem(config.credentials, historyKey, thingsSyncState().serverIndex, uuid, 'Task6', completedFields())
  markTaskCompletedLocally(uuid)
}

export async function recordThingsFocus(
  config: ResolvedThingsConfig,
  uuid: string,
  minutes: number,
): Promise<void> {
  if (config.mode !== 'cloud') {
    await appendThingsFocusNote(config, uuid, minutes)
    return
  }
  const historyKey = await historyKeyFor(config)
  await ensureSynced(config, true)

  // Things has no duration field, so focused time goes on the note. The whole
  // note is rewritten, so it has to be read first or the existing text is lost.
  const existing = readTaskNote(uuid)
  const line = `Focused ${minutes}m via sesh`
  const next = existing.trim() ? `${existing.trimEnd()}\n${line}` : line

  await commitItem(config.credentials, historyKey, thingsSyncState().serverIndex, uuid, 'Task6', noteFields(next))
  setTaskNoteLocally(uuid, next)
}
