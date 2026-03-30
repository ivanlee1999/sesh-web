/**
 * Offline-first local storage helpers for sesh PWA.
 *
 * Timer state: localStorage is source of truth, synced to server opportunistically.
 * Completed sessions queue: stored locally, pushed to server on reconnect.
 * Categories cache: last server response cached, used when offline.
 */

// ── Keys ────────────────────────────────────────────────────────────────
const TIMER_KEY = 'sesh:timer'
const SESSION_QUEUE_KEY = 'sesh:sessionQueue'
const CATEGORIES_CACHE_KEY = 'sesh:categories'

// ── Timer state ─────────────────────────────────────────────────────────
export interface LocalTimerState {
  phase: string
  sessionType: string
  intention: string
  category: string
  targetMs: number
  remainingMs: number
  overflowMs: number
  startedAt: number | null
  pausedAt: number | null
  todoistTaskId: string | null
  savedAt: number // local timestamp
}

export function saveTimerState(state: LocalTimerState): void {
  try {
    localStorage.setItem(TIMER_KEY, JSON.stringify({ ...state, savedAt: Date.now() }))
  } catch {}
}

/** Coerce a value to epoch-ms number, handling ISO strings from legacy state */
function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
    const t = Date.parse(value)
    if (Number.isFinite(t)) return t
  }
  return null
}

export function loadTimerState(): LocalTimerState | null {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (!raw) return null
    const state = JSON.parse(raw) as LocalTimerState
    // Normalize timestamps that might be ISO strings from old state
    state.startedAt = toEpochMs(state.startedAt)
    state.pausedAt = toEpochMs(state.pausedAt)
    state.targetMs = Number.isFinite(state.targetMs) ? state.targetMs : 0
    state.remainingMs = Number.isFinite(state.remainingMs) ? state.remainingMs : 0
    state.overflowMs = Number.isFinite(state.overflowMs) ? state.overflowMs : 0
    return state
  } catch {
    return null
  }
}

export function clearTimerState(): void {
  try {
    localStorage.removeItem(TIMER_KEY)
  } catch {}
}

// ── Offline session queue ───────────────────────────────────────────────
export interface QueuedSession {
  id: string
  intention: string
  category: string
  type: string
  sessionType?: string // legacy compat — prefer `type`
  targetMs: number
  actualMs: number
  overflowMs: number
  startedAt: number
  endedAt: number
  notes: string
  todoistTaskId: string | null
  queuedAt: number
}

export function enqueueSession(session: QueuedSession): void {
  try {
    const queue = getSessionQueue()
    queue.push(session)
    localStorage.setItem(SESSION_QUEUE_KEY, JSON.stringify(queue))
  } catch {}
}

export function getSessionQueue(): QueuedSession[] {
  try {
    const raw = localStorage.getItem(SESSION_QUEUE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as QueuedSession[]
  } catch {
    return []
  }
}

export function clearSessionQueue(): void {
  try {
    localStorage.removeItem(SESSION_QUEUE_KEY)
  } catch {}
}

export function removeQueuedSession(index: number): void {
  try {
    const queue = getSessionQueue()
    queue.splice(index, 1)
    localStorage.setItem(SESSION_QUEUE_KEY, JSON.stringify(queue))
  } catch {}
}

// ── Categories cache ────────────────────────────────────────────────────
export function cacheCategories(categories: unknown[]): void {
  try {
    localStorage.setItem(CATEGORIES_CACHE_KEY, JSON.stringify(categories))
  } catch {}
}

export function getCachedCategories<T>(): T[] | null {
  try {
    const raw = localStorage.getItem(CATEGORIES_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as T[]
  } catch {
    return null
  }
}
