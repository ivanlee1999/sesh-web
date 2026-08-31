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
const CATEGORY_RECENCY_KEY = 'sesh:categoryRecency'
const POMODORO_CYCLE_KEY = 'sesh:pomodoroCycle'
const FOCUS_TIME_QUEUE_KEY = 'sesh:focusTimeQueue'
const PANE_LAYOUT_KEY = 'sesh:paneLayout'
const CALENDAR_VIEW_KEY = 'sesh:calendarView'

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

/** Coerce any value to a finite number, preserving numeric strings like "1500000" */
function toFiniteNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function loadTimerState(): LocalTimerState | null {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (!raw) return null
    const state = JSON.parse(raw) as LocalTimerState
    // Normalize timestamps that might be ISO strings from old state
    state.startedAt = toEpochMs(state.startedAt)
    state.pausedAt = toEpochMs(state.pausedAt)
    state.targetMs = toFiniteNumber(state.targetMs)
    state.remainingMs = toFiniteNumber(state.remainingMs)
    state.overflowMs = toFiniteNumber(state.overflowMs)
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
  rating?: number
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

// ── Focus-time queue ────────────────────────────────────────────────────
/**
 * Focused minutes that have not reached their task's provider yet.
 *
 * A session is saved locally when the network is against it, but the minutes
 * logged against the task used to be fire-and-forget: one bad gateway and the
 * time was gone with nothing to replay. This queue gives that write the same
 * second chance the session itself has.
 */
export interface QueuedFocusTime {
  /** Provider-qualified reference — see lib/task-ref. */
  taskRef: string
  minutes: number
  queuedAt: number
  /** Bounded, so an entry that can never succeed cannot block the queue head. */
  attempts: number
}

/** After this many failures an entry is dropped rather than retried forever. */
export const MAX_FOCUS_TIME_ATTEMPTS = 5

export function enqueueFocusTime(entry: Omit<QueuedFocusTime, 'attempts'>): void {
  try {
    const queue = getFocusTimeQueue()
    queue.push({ ...entry, attempts: 0 })
    localStorage.setItem(FOCUS_TIME_QUEUE_KEY, JSON.stringify(queue))
  } catch {}
}

export function getFocusTimeQueue(): QueuedFocusTime[] {
  try {
    const raw = localStorage.getItem(FOCUS_TIME_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueuedFocusTime[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function removeQueuedFocusTime(index: number): void {
  try {
    const queue = getFocusTimeQueue()
    queue.splice(index, 1)
    localStorage.setItem(FOCUS_TIME_QUEUE_KEY, JSON.stringify(queue))
  } catch {}
}

/** Record a failed attempt, dropping the entry once it has had enough. */
export function markFocusTimeAttempt(index: number): void {
  try {
    const queue = getFocusTimeQueue()
    const entry = queue[index]
    if (!entry) return
    entry.attempts = (entry.attempts ?? 0) + 1
    if (entry.attempts >= MAX_FOCUS_TIME_ATTEMPTS) queue.splice(index, 1)
    localStorage.setItem(FOCUS_TIME_QUEUE_KEY, JSON.stringify(queue))
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

// ── Category recency ─────────────────────────────────────────────────────
export function getRecentCategoryNames(): string[] {
  try {
    const raw = localStorage.getItem(CATEGORY_RECENCY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
  } catch {
    return []
  }
}

export function markCategoryUsed(categoryName: string): string[] {
  if (!categoryName) return getRecentCategoryNames()

  try {
    const next = [categoryName, ...getRecentCategoryNames().filter(name => name !== categoryName)]
    localStorage.setItem(CATEGORY_RECENCY_KEY, JSON.stringify(next))
    return next
  } catch {
    return [categoryName, ...getRecentCategoryNames().filter(name => name !== categoryName)]
  }
}

// ── Pomodoro cycle ───────────────────────────────────────────────────────
// Completed focus sessions today, used to schedule long breaks. Resets on a
// new local day so a fresh morning always starts a fresh cycle.
interface PomodoroCycle {
  count: number
  date: string // local YYYY-MM-DD
}

function localDateStr(): string {
  return new Date().toLocaleDateString('en-CA')
}

export function getPomodoroCycleCount(): number {
  try {
    const raw = localStorage.getItem(POMODORO_CYCLE_KEY)
    if (!raw) return 0
    const cycle = JSON.parse(raw) as PomodoroCycle
    if (cycle.date !== localDateStr()) return 0
    const n = Number(cycle.count)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

export function incrementPomodoroCycle(): number {
  const next = getPomodoroCycleCount() + 1
  try {
    localStorage.setItem(POMODORO_CYCLE_KEY, JSON.stringify({ count: next, date: localDateStr() } satisfies PomodoroCycle))
  } catch {}
  return next
}

// ── Desktop pane layout ─────────────────────────────────────────────────

/**
 * Widths of the resizable desktop panes, in pixels.
 *
 * Deliberately device-local rather than synced with the rest of settings: how
 * wide a queue rail should be is a fact about the monitor in front of you, and
 * pushing a 27-inch layout onto a laptop would be worse than remembering
 * nothing. A pane with no entry falls back to its designed width.
 */
export interface PaneLayout {
  /** The desktop navigation rail. */
  rail?: number
  /** The task queue beside the dial. */
  queue?: number
  /** The Tasks screen's list sidebar. */
  sidebar?: number
}

export type PaneKey = keyof PaneLayout

export function loadPaneLayout(): PaneLayout {
  try {
    const raw = localStorage.getItem(PANE_LAYOUT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: PaneLayout = {}
    for (const key of ['rail', 'queue', 'sidebar'] as PaneKey[]) {
      const value = parsed[key]
      // A stored width is only ever a hint; the pane clamps it to its own
      // bounds on the way out, so a stale or absurd value cannot strand a pane.
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

export function savePaneWidth(key: PaneKey, width: number): void {
  try {
    localStorage.setItem(PANE_LAYOUT_KEY, JSON.stringify({ ...loadPaneLayout(), [key]: Math.round(width) }))
  } catch {}
}

export function clearPaneWidth(key: PaneKey): void {
  try {
    const next = loadPaneLayout()
    delete next[key]
    localStorage.setItem(PANE_LAYOUT_KEY, JSON.stringify(next))
  } catch {}
}

// ── Calendar view ───────────────────────────────────────────────────────

/** Which span the calendar shows. Device-local, like the pane widths. */
export type CalendarView = 'month' | 'week' | 'day'

const CALENDAR_VIEWS: CalendarView[] = ['month', 'week', 'day']

export function loadCalendarView(): CalendarView | null {
  try {
    const raw = localStorage.getItem(CALENDAR_VIEW_KEY)
    return CALENDAR_VIEWS.includes(raw as CalendarView) ? raw as CalendarView : null
  } catch {
    return null
  }
}

export function saveCalendarView(view: CalendarView): void {
  try {
    localStorage.setItem(CALENDAR_VIEW_KEY, view)
  } catch {}
}
