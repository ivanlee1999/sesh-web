import 'server-only'
import { dayClock, dayStartUtcSeconds, type DayClock } from './task-dates'
import { rememberHistoryKey, type ResolvedThingsConfig } from './things-config'
import {
  ACTION_CREATED,
  ThingsAuthError,
  commitItem,
  completedFields,
  createdTaskFields,
  newTaskUuid,
  noteFields,
  verifyAccount,
  type ThingsWhen,
} from './things-cloud'
import {
  applyItems,
  markTaskCompletedLocally,
  readTaskNote,
  readTasks,
  setTaskNoteLocally,
  syncThings,
  thingsSyncState,
  type SyncOutcome,
  type ThingsView,
} from './things-store'
import {
  appendThingsFocusNote,
  completeThingsTask,
  createThingsTask,
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

/**
 * How long a request will wait on Things before answering with what has already
 * been replayed. A first sync of a long-standing account is minutes of work —
 * far past the point a reverse proxy gives up on the origin and returns a 502 —
 * so no request ever waits for the whole of it.
 */
const READ_WAIT_MS = 6_000

/** A write waits a little longer: it needs a current stream head to commit at. */
const WRITE_WAIT_MS = 12_000

/** The background pass has nobody waiting on it, so it may run much longer. */
const BACKGROUND_BUDGET_MS = 45_000

/** Bounds the catch-up loop so a stream that never converges cannot spin. */
const MAX_CATCHUP_PASSES = 40

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

/**
 * At most one sync runs at a time.
 *
 * Without this, every concurrent request started its own replay of the same
 * items: the same pages fetched several times over and several writers taking
 * turns blocking the event loop, which is how a slow sync became an outage
 * rather than just a slow list.
 */
let inFlight: Promise<SyncOutcome> | null = null
let catchingUp = false

function startSync(config: Extract<ResolvedThingsConfig, { mode: 'cloud' }>): Promise<SyncOutcome> {
  if (inFlight) return inFlight
  const run = (async () => {
    const historyKey = await historyKeyFor(config)
    return syncThings(config.credentials, historyKey, { budgetMs: BACKGROUND_BUDGET_MS })
  })()
  inFlight = run
  // Registered before any caller's handler, so the slot is already free by the
  // time they react — otherwise the catch-up loop below would be handed the
  // same finished promise over and over and spin without doing any work. The
  // no-op rejection handler also keeps a request that walked away on its
  // budget from leaving this unhandled.
  const release = () => { if (inFlight === run) inFlight = null }
  run.then(release, release)
  return run
}

/**
 * Keeps pulling after the response has gone out. Everything already replayed is
 * visible immediately, and the rest arrives over the next few seconds, instead
 * of the first load hanging until the whole history has been read.
 */
function scheduleCatchUp(config: Extract<ResolvedThingsConfig, { mode: 'cloud' }>) {
  if (catchingUp) return
  catchingUp = true
  void (async () => {
    try {
      for (let pass = 0; pass < MAX_CATCHUP_PASSES; pass += 1) {
        const outcome = await startSync(config)
        if (outcome.caughtUp) break
      }
    } catch {
      // Things being unavailable is never fatal here — the next read retries.
    } finally {
      catchingUp = false
    }
  })()
}

/**
 * True while there is known to be more history still to replay, so a caller can
 * say "still catching up" rather than present a short list as the whole story.
 */
export function thingsCatchingUp(): boolean {
  return catchingUp
}

/** Resolves on the sync, or on the deadline, whichever comes first. */
function waitAtMost(sync: Promise<SyncOutcome>, ms: number): Promise<SyncOutcome | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms)
    // `unref` so a pending wait cannot hold the process open on shutdown.
    timer.unref?.()
    sync.then(
      outcome => { clearTimeout(timer); resolve(outcome) },
      () => { clearTimeout(timer); resolve(null) },
    )
  })
}

/**
 * Brings the local replay up to date, but only if it has gone stale, and only
 * for as long as the caller can afford to wait.
 */
async function ensureSynced(config: Extract<ResolvedThingsConfig, { mode: 'cloud' }>, waitMs = READ_WAIT_MS) {
  const state = thingsSyncState()
  if (state.syncedAt > 0 && Date.now() - state.syncedAt < SYNC_INTERVAL_MS) return

  const sync = startSync(config)
  const outcome = await waitAtMost(sync, waitMs)
  if (!outcome || !outcome.caughtUp) scheduleCatchUp(config)
}

/**
 * A Things date is a floating calendar day written as midnight UTC — the same
 * `1770681600` reaches every device regardless of where it is. Reading the day
 * back out in UTC therefore gives the day the person picked; reading it in the
 * server's timezone would shift it by one for most of the world.
 */
function thingsDayKey(seconds: number | null): string | null {
  if (!seconds) return null
  return new Date(seconds * 1000).toISOString().slice(0, 10)
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
  clock: DayClock = dayClock(),
): Promise<ThingsTaskRaw[]> {
  if (config.mode !== 'cloud') {
    return listThingsTasks(config, VIEWS_BY_FILTER[filter])
  }

  await ensureSynced(config)
  return readTasks(VIEWS_BY_FILTER[filter], dayStartUtcSeconds(clock.today)).map(task => ({
    uuid: task.uuid,
    title: task.title,
    note: task.note,
    start_date: thingsDayKey(task.scheduledAt),
    deadline: thingsDayKey(task.deadlineAt),
    project_title: task.projectTitle,
    area_title: task.areaTitle,
    tags: task.tags,
    completed: false,
    view: task.view,
  }))
}

export async function completeThings(config: ResolvedThingsConfig, uuid: string): Promise<void> {
  if (config.mode !== 'cloud') {
    await completeThingsTask(config, uuid)
    return
  }
  const historyKey = await historyKeyFor(config)
  // ancestor-index is the writer's view of the stream head, so pull first —
  // but only for as long as a write can reasonably wait. Things.app commits
  // against its own last-known head too; being a little behind orders the
  // commit slightly earlier, it does not lose it.
  await ensureSynced(config, WRITE_WAIT_MS)
  await commitItem(config.credentials, historyKey, thingsSyncState().serverIndex, uuid, 'Task6', completedFields())
  markTaskCompletedLocally(uuid)
}

/**
 * Add a to-do.
 *
 * A create is the one write that has to carry a whole item rather than a patch,
 * so the cloud path builds the full payload and then replays it locally — the
 * next sync would otherwise be the first time the new to-do appeared, which
 * reads as the button having done nothing.
 */
export async function createThings(
  config: ResolvedThingsConfig,
  input: { title: string; when: ThingsWhen },
  todayStart: number,
): Promise<void> {
  if (config.mode !== 'cloud') {
    await createThingsTask(config, input)
    return
  }
  const historyKey = await historyKeyFor(config)
  await ensureSynced(config, WRITE_WAIT_MS)

  const uuid = newTaskUuid()
  const fields = createdTaskFields(input.title, input.when, todayStart)
  await commitItem(
    config.credentials,
    historyKey,
    thingsSyncState().serverIndex,
    uuid,
    'Task6',
    fields,
    ACTION_CREATED,
  )
  applyItems([{ uuid, kind: 'Task6', action: ACTION_CREATED, payload: fields }])
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
  await ensureSynced(config, WRITE_WAIT_MS)

  // Things has no duration field, so focused time goes on the note. The whole
  // note is rewritten, so it has to be read first or the existing text is lost.
  const existing = readTaskNote(uuid)
  const line = `Focused ${minutes}m via sesh`
  const next = existing.trim() ? `${existing.trimEnd()}\n${line}` : line

  await commitItem(config.credentials, historyKey, thingsSyncState().serverIndex, uuid, 'Task6', noteFields(next))
  setTaskNoteLocally(uuid, next)
}
