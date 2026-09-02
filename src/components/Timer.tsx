'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveProvider, type Category, type CategoryRecord, type ExternalTask, type SessionType } from '@/types'
import { useSettings } from '@/context/SettingsContext'
import { useCategories } from '@/context/CategoriesContext'
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock'
import { useFitSquare } from '@/hooks/useFitSquare'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { ensurePushSubscription, isInstalledPwa } from '@/lib/push-client'
import { clearTimerState, enqueueFocusTime, enqueueSession, getPomodoroCycleCount, getRecentCategoryNames, incrementPomodoroCycle, loadTimerState, markCategoryUsed, saveTimerState, type QueuedSession } from '@/lib/local-store'
import { decodeTaskRefs, encodeTaskRef, encodeTaskRefs, splitTaskRefs } from '@/lib/task-ref'
import { PROVIDER_COLOR, PROVIDER_LABEL, canCreateTasks, completeTask as completeProviderTask, enabledProviders, flushFocusTimeQueue, loadProviderStatuses, loadTasks, recordFocusTime, refsForProviders } from '@/lib/task-sources'
import { capGroups, clockOf, endsAtLabel, pad2, type CappedGroup } from '@/lib/modernist'
import Dial from './Dial'
import CategoryChips from './md/CategoryChips'
import TaskList, { type TaskRowModel } from './md/TaskList'
import TaskComposer from './md/TaskComposer'
import ResizeHandle from './md/ResizeHandle'
import { usePaneWidth } from '@/hooks/usePaneWidth'
import { MdIcon } from './md/icons'
import { useShellStatus } from './md/shell-status'
import type { PendingFocus } from './Tasks'

type TimerRunPhase = 'idle' | 'running' | 'paused' | 'reflect'

/** The three cells of the segmented control, over the repo's two real types. */
type TypeKey = 'focus' | 'short' | 'long'

/** What the poster hands back to: the dial, a break, or straight into focus. */
type PosterNext = 'idle' | 'break' | 'focus'
type Scope = 'today' | 'upcoming' | 'all'

/** The designed queue width, and how far it may be dragged from it. */
const QUEUE_BOUNDS = { min: 248, max: 520, fallback: 326 }

/**
 * The hairlines drawn on the poster's accent field: the same ink as its type,
 * held back so they read as rules rather than as another line of text. Held
 * back from `--accent-on` rather than from white, since the ink flips to dark
 * on the pale end of the palette and a white rule would vanish there.
 */
const RULE_ON_ACCENT = 'color-mix(in srgb, var(--accent-on) 28%, transparent)'
/** A tonal fill on the poster: the ink at a whisper, for chips and the task card. */
const FILL_ON_ACCENT = 'color-mix(in srgb, var(--accent-on) 14%, transparent)'

interface ServerTimerState {
  phase: string
  sessionType: string
  intention: string
  category: string
  targetMs: number
  remainingMs: number
  overflowMs: number
  startedAt: number | null
  pausedAt: number | null
  updatedAt: number
  todoistTaskId: string | null
}

interface ReflectionDraft {
  id: string
  intention: string
  category: string
  type: SessionType
  targetMs: number
  actualMs: number
  overflowMs: number
  startedAt: number
  endedAt: number
  todoistTaskId: string | null
}

function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
    const t = Date.parse(value)
    if (Number.isFinite(t)) return t
  }
  return null
}

function normalizeTimerState(data: ServerTimerState): ServerTimerState {
  return {
    ...data,
    targetMs: Number.isFinite(data.targetMs) ? data.targetMs : 0,
    remainingMs: Number.isFinite(data.remainingMs) ? data.remainingMs : 0,
    overflowMs: Number.isFinite(data.overflowMs) ? data.overflowMs : 0,
    startedAt: toEpochMs(data.startedAt),
    pausedAt: toEpochMs(data.pausedAt),
    updatedAt: Number.isFinite(data.updatedAt) ? data.updatedAt : Date.now(),
  }
}

function playChime(frequency = 880) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(frequency, ctx.currentTime)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7)
    osc.start()
    osc.stop(ctx.currentTime + 0.7)
  } catch {}
}

function makeCompletedDraft({
  startedAt,
  endedAt,
  targetMs,
  intention,
  category,
  sessionType,
  todoistTaskId,
}: {
  startedAt: number
  endedAt: number
  targetMs: number
  intention: string
  category: Category
  sessionType: SessionType
  todoistTaskId: string | null
}): ReflectionDraft {
  const actualMs = Math.max(targetMs, endedAt - startedAt)
  return {
    id: `manual-${startedAt}`,
    intention,
    category,
    type: sessionType,
    targetMs,
    actualMs,
    overflowMs: Math.max(0, actualMs - targetMs),
    startedAt,
    endedAt,
    todoistTaskId,
  }
}

function categoryByName(categories: CategoryRecord[], name: string): CategoryRecord | null {
  return categories.find(category => category.name === name) ?? categories[0] ?? null
}

function taskCategory(task: ExternalTask, categories: CategoryRecord[], fallback: string): string {
  const candidates = [task.category, ...(task.labels ?? [])].filter(Boolean).map(value => String(value).toLowerCase())
  for (const candidate of candidates) {
    const found = categories.find(category => category.name.toLowerCase() === candidate || category.label.toLowerCase() === candidate)
    if (found) return found.name
  }
  return fallback
}

/** A task's own estimate, in minutes, or null when it carries none. */
function estimateMinutes(task: ExternalTask): number | null {
  const amount = task.duration?.amount
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : null
}

function estimateLabel(task: ExternalTask): string {
  const minutes = estimateMinutes(task)
  return minutes === null ? '' : `${minutes}m`
}

function inScope(task: ExternalTask, scope: Scope): boolean {
  if (scope === 'all') return true
  if (scope === 'today') return task.due === 'today'
  return task.due === 'tomorrow' || task.due === 'upcoming'
}

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'all', label: 'All' },
]

function ScopeChips({ scope, onChange }: { scope: Scope; onChange: (next: Scope) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {SCOPES.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className="md-quiet md-press"
          data-active={scope === key ? 'true' : 'false'}
          aria-pressed={scope === key}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Timer({
  onImmersive,
  pendingFocus,
  clearPendingFocus,
}: {
  onImmersive?: (immersive: boolean) => void
  pendingFocus?: PendingFocus | null
  clearPendingFocus?: () => void
}) {
  const { settings, loaded: settingsLoaded, updateSettings } = useSettings()
  const { categories, byName } = useCategories()
  const { reportSub, reportAccent } = useShellStatus()
  const isDesktop = useIsDesktop()
  const phone = !isDesktop
  // Only this one setting decides which providers are asked; depending on the
  // whole object would re-fetch every task on an unrelated preference change.
  const providers = useMemo(() => enabledProviders(settings), [settings.todoistEnabled]) // eslint-disable-line react-hooks/exhaustive-deps
  const [phase, setPhase] = useState<TimerRunPhase>('idle')
  const [sessionType, setSessionType] = useState<SessionType>('focus')
  const [typeKey, setTypeKey] = useState<TypeKey>('focus')
  const [intention, setIntention] = useState('')
  const [category, setCategory] = useState<Category>('')
  const [remainingMs, setRemainingMs] = useState(settings.focusDuration * 60000)
  const [targetMs, setTargetMs] = useState(settings.focusDuration * 60000)
  const [dragMinutes, setDragMinutes] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  // The tasks this session is against, as provider-qualified refs (see
  // lib/task-ref). A session can carry several; the API field and DB column
  // still take the one string they always did.
  const [taskRefs, setTaskRefs] = useState<string[]>([])
  const [sheet, setSheet] = useState(false)
  const [sheetClosing, setSheetClosing] = useState(false)
  const [scope, setScope] = useState<Scope>('today')
  const [recentCategories, setRecentCategories] = useState<string[]>([])
  const [tasks, setTasks] = useState<ExternalTask[]>([])
  const [canCompose, setCanCompose] = useState(false)
  const [completingKey, setCompletingKey] = useState<string | null>(null)
  const [taskNotice, setTaskNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<ReflectionDraft | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [cycleCount, setCycleCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const finishingRef = useRef(false)
  const prevRemainingRef = useRef<number | null>(null)
  /**
   * The topic as the server last saw it. The live title is a controlled field,
   * so by the time it blurs `intention` already holds the new text — comparing
   * against state would make every commit look like a no-op, and comparing
   * against nothing would drop the linked tasks on a blur that changed nothing.
   */
  const syncedIntentionRef = useRef('')

  const wakeLock = useScreenWakeLock(settings.keepScreenAwake && phase === 'running')

  const live = phase === 'running' || phase === 'paused'
  const idle = !live

  useEffect(() => {
    onImmersive?.(live)
  }, [live, onImmersive])

  useEffect(() => {
    setRecentCategories(getRecentCategoryNames())
    setCycleCount(getPomodoroCycleCount())
  }, [])

  /**
   * The open tasks, held here rather than in the picker: the idle screen also
   * names the tasks a session is already pointed at, and both should be
   * looking at the same list.
   */
  const refreshTasks = useCallback(async () => {
    try {
      const statuses = await loadProviderStatuses(providers)
      if (statuses.some(s => s.state === 'auth_required')) {
        setTaskNotice('Auth required. Sign in again to choose tasks.')
        setTasks([])
        return
      }
      const connected = statuses.filter(s => s.state === 'connected').map(s => s.provider)
      setCanCompose(connected.some(canCreateTasks))
      if (connected.length === 0) {
        // Nothing configured is a normal state, not an error worth surfacing.
        setTaskNotice(null)
        setTasks([])
        return
      }
      const { tasks: loaded, errors } = await loadTasks('all', connected)
      setTasks(loaded.filter(task => !task.completed))
      setTaskNotice(errors.length > 0
        ? errors.map(e => `${PROVIDER_LABEL[e.provider]}: ${e.message}`).join(' · ')
        : null)
    } catch {
      setTasks([])
    }
  }, [providers])

  // Waits for the stored settings: `providers` is only the default until they
  // land, and a provider that has been switched off must not be queried at all.
  useEffect(() => {
    if (!settingsLoaded) return
    void refreshTasks()
  }, [refreshTasks, settingsLoaded])

  useEffect(() => {
    if (categories.length === 0) return
    if (category && byName[category]) return
    const defaultCategory = categories.find(item => item.isDefault) ?? categories[0]
    setCategory(defaultCategory.name)
  }, [byName, categories, category])

  /** What the server and local store take: one string, however many tasks. */
  const taskRefValue = useMemo(() => encodeTaskRefs(taskRefs), [taskRefs])

  /**
   * The picked tasks themselves, resolved against the live list so a refresh
   * cannot leave a stale title on screen. A ref with no match — the task was
   * closed elsewhere, or its provider has since been switched off — is still
   * counted, rather than silently vanishing from a session that is going to
   * log time against it.
   */
  const selectedTasks = useMemo(() => {
    const byRef = new Map(tasks.map(task => [encodeTaskRef(resolveProvider(task), task.id), task]))
    return taskRefs.map(ref => ({ ref, task: byRef.get(ref) ?? null }))
  }, [taskRefs, tasks])

  useEffect(() => {
    if (!pendingFocus) return
    setIntention(pendingFocus.intention)
    if (pendingFocus.category && byName[pendingFocus.category]) setCategory(pendingFocus.category)
    setTaskRefs(pendingFocus.taskIds)
    setSessionType('focus')
    setTypeKey('focus')
    setRemainingMs(settings.focusDuration * 60000)
    setTargetMs(settings.focusDuration * 60000)
    clearPendingFocus?.()
  }, [byName, clearPendingFocus, pendingFocus, settings.focusDuration])

  const syncToServer = useCallback(async (body: Record<string, unknown>) => {
    try {
      await fetch('/api/timer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {}
  }, [])

  const postSwMessage = useCallback(async (type: 'TIMER_STARTED' | 'TIMER_STOPPED') => {
    if (!('serviceWorker' in navigator)) return
    try {
      const reg = await navigator.serviceWorker.ready
      reg.active?.postMessage({ type })
    } catch {}
  }, [])

  const applyRemote = useCallback((raw: ServerTimerState) => {
    const data = normalizeTimerState(raw)
    if (data.phase === 'running' && data.startedAt) {
      const elapsed = Date.now() - data.updatedAt
      const nextRemaining = data.remainingMs - elapsed
      setSessionType(data.sessionType as SessionType)
      setTypeKey(data.sessionType === 'focus'
        ? 'focus'
        : data.targetMs === settings.longBreakDuration * 60000 ? 'long' : 'short')
      setIntention(data.intention)
      syncedIntentionRef.current = data.intention
      setCategory(data.category as Category)
      setTargetMs(data.targetMs)
      setStartedAt(data.startedAt)
      setTaskRefs(refsForProviders(data.todoistTaskId, providers))
      // Breaks restore into overtime just like focus. Coming back to the app
      // after the break ran long should show the rest still counting, not drop
      // you on the idle screen having quietly thrown the extra time away. The
      // auto-start-focus effect picks an overdue break up from here.
      setPhase('running')
      setRemainingMs(nextRemaining)
    } else if (data.phase === 'paused') {
      setPhase('paused')
      setSessionType(data.sessionType as SessionType)
      setIntention(data.intention)
      syncedIntentionRef.current = data.intention
      setCategory(data.category as Category)
      setRemainingMs(data.remainingMs)
      setTargetMs(data.targetMs)
      setStartedAt(data.startedAt ?? 0)
      setTaskRefs(refsForProviders(data.todoistTaskId, providers))
    } else if (data.phase === 'idle') {
      setPhase('idle')
      if (data.category) setCategory(data.category as Category)
      if (data.intention) setIntention(data.intention)
      setSessionType('focus')
      setTypeKey('focus')
      setTargetMs(settings.focusDuration * 60000)
      setRemainingMs(settings.focusDuration * 60000)
      setStartedAt(0)
    }
  }, [providers, settings.focusDuration, settings.longBreakDuration])

  const restoreLocal = useCallback(() => {
    const local = loadTimerState()
    if (!local) return
    setSessionType(local.sessionType as SessionType)
    setIntention(local.intention)
    syncedIntentionRef.current = local.intention
    setCategory(local.category)
    setTargetMs(local.targetMs)
    setTaskRefs(refsForProviders(local.todoistTaskId, providers))
    if (local.phase === 'running' && local.startedAt) {
      // Overdue breaks keep running, same as focus — see applyRemote.
      setPhase('running')
      setRemainingMs(local.remainingMs - (Date.now() - local.savedAt))
      setStartedAt(local.startedAt)
    } else if (local.phase === 'paused') {
      setPhase('paused')
      setRemainingMs(local.remainingMs)
      setStartedAt(local.startedAt ?? 0)
    }
  }, [providers])

  const refreshTimerFromServer = useCallback(() => {
    fetch('/api/timer')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) applyRemote(data); else restoreLocal() })
      .catch(restoreLocal)
  }, [applyRemote, restoreLocal])

  useEffect(() => {
    refreshTimerFromServer()
  }, [refreshTimerFromServer])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshTimerFromServer()
    }
    const handlePageShow = () => {
      refreshTimerFromServer()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [refreshTimerFromServer])

  /**
   * Replay focused minutes that never landed — on open, on reconnect, and on
   * coming back to the app. The timer is mounted for as long as sesh is, so
   * this is the one place guaranteed to be listening. A failure here is the
   * queue's business, not the screen's, so nothing is reported.
   */
  useEffect(() => {
    if (!settingsLoaded) return
    const retry = () => { void flushFocusTimeQueue() }
    const onVisible = () => { if (document.visibilityState === 'visible') retry() }

    retry()
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [settingsLoaded])

  useEffect(() => {
    if (phase === 'reflect') return
    saveTimerState({
      phase,
      sessionType,
      intention,
      category,
      targetMs,
      remainingMs,
      overflowMs: Math.max(0, -remainingMs),
      startedAt: startedAt || null,
      pausedAt: phase === 'paused' ? Date.now() : null,
      todoistTaskId: taskRefValue,
      savedAt: Date.now(),
    })
  }, [category, intention, phase, remainingMs, sessionType, startedAt, targetMs, taskRefValue])

  useEffect(() => {
    if (phase !== 'running') {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      return
    }
    intervalRef.current = setInterval(() => {
      setRemainingMs(prev => prev - 1000)
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    // Not just phase: a focus session rolling straight into its break stays
    // 'running' throughout, and finish() clears the interval on the way past —
    // without this the break would sit there not counting. sessionType covers
    // the hand-off even if both sessions land on the same millisecond.
  }, [phase, sessionType, startedAt])

  const selectedCategory = categoryByName(categories, category)
  const sortedCategories = useMemo(() => {
    const order = new Map(recentCategories.map((name, index) => [name, index]))
    return [...categories].sort((a, b) => {
      const ao = order.get(a.name)
      const bo = order.get(b.name)
      if (ao !== undefined || bo !== undefined) {
        if (ao === undefined) return 1
        if (bo === undefined) return -1
        return ao - bo
      }
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.label.localeCompare(b.label)
    })
  }, [categories, recentCategories])

  /** Which stored duration the segmented control's current cell writes to. */
  const durationKeyFor = (key: TypeKey) =>
    key === 'focus' ? 'focusDuration' : key === 'short' ? 'breakDuration' : 'longBreakDuration'

  const commitIdleDuration = useCallback((minutes: number) => {
    const nextMinutes = Math.min(60, Math.max(1, Math.round(minutes)))
    const nextTarget = nextMinutes * 60000

    updateSettings({ [durationKeyFor(typeKey)]: nextMinutes })

    setTargetMs(nextTarget)
    setRemainingMs(nextTarget)
    syncToServer({
      phase: 'idle',
      sessionType,
      intention,
      category,
      targetMs: nextTarget,
      remainingMs: nextTarget,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
      todoistTaskId: taskRefValue,
    })
  }, [category, intention, sessionType, syncToServer, taskRefValue, typeKey, updateSettings])

  /**
   * Push the idle screen's topic to the server. Every field is passed in
   * rather than read from state: picking a task changes the intention, the
   * category and the links at once, and React has not applied any of them yet.
   */
  const syncIdleTopic = useCallback((next: { intention: string; category: Category; refs: string[]; targetMs?: number }) => {
    const nextTarget = next.targetMs ?? targetMs
    syncToServer({
      phase: 'idle',
      sessionType,
      intention: next.intention,
      category: next.category,
      targetMs: nextTarget,
      remainingMs: nextTarget,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
      todoistTaskId: encodeTaskRefs(next.refs),
    })
  }, [sessionType, syncToServer, targetMs])

  /**
   * Change which tasks the next session is against. The topic is rewritten to
   * name them — it is the one line that says what the session is for — and the
   * first task, being the one that leads, decides the category and the length.
   */
  /**
   * Which tasks the picker is currently choosing for. With the poster up it is
   * editing the session that just ended; otherwise it is setting up the next
   * one. Everything downstream — the selected state, the picker's writes —
   * reads this rather than assuming.
   */
  const draftRefs = useMemo(() => splitTaskRefs(draft?.todoistTaskId), [draft])
  const editingDraft = draft !== null
  const activeRefs = editingDraft ? draftRefs : taskRefs

  /**
   * Re-file the finished session against a different set of tasks. The title
   * and category follow the lead task, exactly as picking one does before a
   * session — and because nothing has been written back yet (that happens on
   * save), the minutes land on whatever is chosen here.
   */
  const applyDraftTasks = useCallback((nextRefs: string[]) => {
    const byRef = new Map(tasks.map(task => [encodeTaskRef(resolveProvider(task), task.id), task]))
    const picked = nextRefs.map(ref => byRef.get(ref)).filter((task): task is ExternalTask => !!task)
    setDraft(prev => prev ? {
      ...prev,
      intention: picked.length > 0 ? picked.map(task => task.content).join(' · ') : prev.intention,
      category: picked.length > 0 ? taskCategory(picked[0], categories, prev.category) : prev.category,
      todoistTaskId: encodeTaskRefs(nextRefs),
    } : prev)
  }, [categories, tasks])

  const applyTaskRefs = useCallback((nextRefs: string[]) => {
    const byRef = new Map(tasks.map(task => [encodeTaskRef(resolveProvider(task), task.id), task]))
    const picked = nextRefs.map(ref => byRef.get(ref)).filter((task): task is ExternalTask => !!task)
    const nextIntention = picked.map(task => task.content).join(' · ')
    const nextCategory = picked.length > 0 ? taskCategory(picked[0], categories, category) : category

    // A task that carries its own estimate sets the length, clamped to
    // something a single sitting can actually be.
    const lead = picked[0] ? estimateMinutes(picked[0]) : null
    const nextTarget = lead === null ? targetMs : Math.min(60, Math.max(5, lead)) * 60000

    setTaskRefs(nextRefs)
    setIntention(nextIntention)
    setCategory(nextCategory)
    if (lead !== null) {
      setTargetMs(nextTarget)
      setRemainingMs(nextTarget)
    }
    if (nextCategory) setRecentCategories(markCategoryUsed(nextCategory))
    syncIdleTopic({ intention: nextIntention, category: nextCategory, refs: nextRefs, targetMs: nextTarget })
  }, [categories, category, syncIdleTopic, targetMs, tasks])

  const toggleTaskRef = useCallback((task: ExternalTask) => {
    const ref = encodeTaskRef(resolveProvider(task), task.id)
    const next = activeRefs.includes(ref) ? activeRefs.filter(r => r !== ref) : [...activeRefs, ref]
    if (editingDraft) applyDraftTasks(next)
    else applyTaskRefs(next)
  }, [activeRefs, applyDraftTasks, applyTaskRefs, editingDraft])

  /**
   * The sheet stays mounted through its exit animation, so closing schedules
   * the unmount rather than doing it. Reopening inside that window has to
   * cancel the pending unmount — otherwise the timer fires against the *new*
   * sheet and closes it out from under you, which is easy to hit going from
   * the idle picker to the poster's.
   */
  const sheetCloseTimer = useRef<number | null>(null)

  const openSheet = useCallback(() => {
    if (sheetCloseTimer.current !== null) {
      window.clearTimeout(sheetCloseTimer.current)
      sheetCloseTimer.current = null
    }
    setSheet(true)
    setSheetClosing(false)
  }, [])

  const closeSheet = useCallback(() => {
    setSheetClosing(true)
    sheetCloseTimer.current = window.setTimeout(() => {
      sheetCloseTimer.current = null
      setSheet(false)
      setSheetClosing(false)
    }, 260)
  }, [])

  useEffect(() => () => {
    if (sheetCloseTimer.current !== null) window.clearTimeout(sheetCloseTimer.current)
  }, [])

  const focusOneTask = useCallback((task: ExternalTask) => {
    const only = [encodeTaskRef(resolveProvider(task), task.id)]
    if (editingDraft) applyDraftTasks(only)
    else applyTaskRefs(only)
    if (sheet) closeSheet()
  }, [applyDraftTasks, applyTaskRefs, closeSheet, editingDraft, sheet])

  const completeOne = useCallback(async (task: ExternalTask) => {
    const key = encodeTaskRef(resolveProvider(task), task.id)
    setCompletingKey(key)
    try {
      await completeProviderTask(task)
      // Let the leave animation play before the row is actually removed.
      window.setTimeout(() => {
        setTasks(prev => prev.filter(t => encodeTaskRef(resolveProvider(t), t.id) !== key))
        setCompletingKey(null)
      }, 420)
    } catch (err) {
      setCompletingKey(null)
      setTaskNotice(err instanceof Error ? err.message : 'Failed to complete task')
    }
  }, [])

  const isFocus = sessionType === 'focus'
  const idleBaseMinutes = Math.max(1, Math.round(targetMs / 60000)) || settings.focusDuration
  const idleDurationMinutes = dragMinutes ?? idleBaseMinutes
  const totalMs = idle ? idleDurationMinutes * 60000 : targetMs || settings.focusDuration * 60000
  // Idle shows the length being set; live shows how much of it has gone.
  const progress = idle
    ? Math.min(1, idleDurationMinutes / 60)
    : Math.min(1, Math.max(0, 1 - (remainingMs / Math.max(totalMs, 1))))
  const isOvertime = remainingMs < 0
  const overflowSec = Math.max(0, Math.ceil(-remainingMs / 1000))
  const elapsedSec = live ? Math.max(0, Math.floor((totalMs - remainingMs) / 1000)) : 0
  const onDarkGround = live || settings.darkMode
  /* The category colour as the accent engine has already drawn it for this
     ground — the shell points `--accent-base` at the selected category. */
  const dialCol = 'var(--accent-base)'
  const sessionNo = cycleCount + 1

  /*
   * How long the break after this sitting runs. `cycleCount` has already been
   * advanced by finish(), so this is the same sum the auto-start path does —
   * the two must agree, or taking the break by hand would give you a different
   * length from letting it start itself.
   */
  const nextBreakMinutes = cycleCount % settings.sessionsBeforeLongBreak === 0
    ? settings.longBreakDuration
    : settings.breakDuration

  /**
   * The category is the interface's colour, not just the dial's — reporting it
   * to the shell re-themes every screen, so the timer and the tasks list and
   * the calendar all agree on what is being worked on.
   */
  useEffect(() => {
    reportAccent(selectedCategory?.color ?? null)
  }, [reportAccent, selectedCategory?.color]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The handoff's 226px desktop dial was drawn for a 1180×760 frame; on a real
   * monitor it reads small next to the rails. The cap is raised so the dial
   * takes the room the desktop actually has, and `useFitSquare` still shrinks
   * it to whatever the fixed rows leave — so a short window is unaffected.
   */
  const queue = usePaneWidth('queue', QUEUE_BOUNDS)

  const dialCap = phone ? 250 : 360
  const [dialFitRef, dialSize] = useFitSquare(dialCap, 132)
  // Every readout is quoted against the 250px phone dial, matching Dial's own
  // scale, so the centre stays in proportion at whatever size it lands on.
  const dialScale = dialSize / 250
  const clockSize = Math.round(42 * dialScale)

  const typeLabel = typeKey === 'focus' ? 'Focus' : typeKey === 'short' ? 'Short break' : 'Long break'

  const selectType = (key: TypeKey) => {
    const minutes = settings[durationKeyFor(key)]
    const nextType: SessionType = key === 'focus' ? 'focus' : 'break'
    const nextTarget = minutes * 60000
    setDragMinutes(null)
    setTypeKey(key)
    setSessionType(nextType)
    setTargetMs(nextTarget)
    setRemainingMs(nextTarget)
    syncToServer({
      phase: 'idle',
      sessionType: nextType,
      intention,
      category,
      targetMs: nextTarget,
      remainingMs: nextTarget,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
      todoistTaskId: taskRefValue,
    })
  }

  const start = useCallback((type: SessionType = sessionType, startingIntention = intention, startingCategory = category, startingTaskRefs = taskRefs, durationMinutes?: number) => {
    const configuredTarget = (type === 'focus' ? settings.focusDuration : settings.breakDuration) * 60000
    const nextTarget = durationMinutes
      ? durationMinutes * 60000
      : phase === 'idle' && type === sessionType && targetMs > 0 ? targetMs : configuredTarget
    const now = Date.now()
    prevRemainingRef.current = null
    if (settings.keepScreenAwake) void wakeLock.request({ allowWhileInactive: true })
    if (type === 'focus') void ensurePushSubscription({ requestPermission: isInstalledPwa() }).catch(() => {})
    setPhase('running')
    setSessionType(type)
    // Keep the segmented cell in step with what actually started: an
    // auto-started long break must not sit under a heading that says "Focus".
    setTypeKey(type === 'focus'
      ? 'focus'
      : nextTarget === settings.longBreakDuration * 60000 ? 'long' : 'short')
    setStartedAt(now)
    setTargetMs(nextTarget)
    setRemainingMs(nextTarget)
    setIntention(startingIntention)
    syncedIntentionRef.current = startingIntention
    setCategory(startingCategory)
    setTaskRefs(startingTaskRefs)
    if (startingCategory) setRecentCategories(markCategoryUsed(startingCategory))
    syncToServer({
      phase: 'running',
      sessionType: type,
      intention: startingIntention,
      category: startingCategory,
      targetMs: nextTarget,
      remainingMs: nextTarget,
      overflowMs: 0,
      startedAt: now,
      pausedAt: null,
      todoistTaskId: encodeTaskRefs(startingTaskRefs),
    })
    postSwMessage('TIMER_STARTED')
  }, [category, intention, phase, postSwMessage, sessionType, settings.breakDuration, settings.focusDuration, settings.keepScreenAwake, settings.longBreakDuration, syncToServer, targetMs, taskRefs, wakeLock])

  const pause = () => {
    setPhase('paused')
    syncToServer({
      phase: 'paused',
      sessionType,
      intention,
      category,
      targetMs,
      remainingMs,
      overflowMs: 0,
      startedAt,
      pausedAt: Date.now(),
      todoistTaskId: taskRefValue,
    })
    postSwMessage('TIMER_STOPPED')
  }

  const resume = () => {
    if (settings.keepScreenAwake) void wakeLock.request({ allowWhileInactive: true })
    setPhase('running')
    syncToServer({
      phase: 'running',
      sessionType,
      intention,
      category,
      targetMs,
      remainingMs,
      overflowMs: 0,
      startedAt,
      pausedAt: null,
      todoistTaskId: taskRefValue,
    })
    postSwMessage('TIMER_STARTED')
  }

  /**
   * Rewrite the topic of the session in flight. The change applies to the
   * whole session — the draft is built from this state when it ends — and is
   * pushed so other clients and notifications stay in step. A rewritten
   * intention drops the linked tasks, so time is never logged against work you
   * moved off.
   */
  const changeRunningTopic = useCallback((nextIntention: string) => {
    if (nextIntention === syncedIntentionRef.current) return
    syncedIntentionRef.current = nextIntention
    setIntention(nextIntention)
    setTaskRefs([])
    syncToServer({
      phase,
      sessionType,
      intention: nextIntention,
      category,
      targetMs,
      remainingMs,
      overflowMs: Math.max(0, -remainingMs),
      startedAt: startedAt || null,
      pausedAt: phase === 'paused' ? Date.now() : null,
      todoistTaskId: null,
    })
  }, [category, phase, remainingMs, sessionType, startedAt, syncToServer, targetMs])

  const idleServerState = useCallback(() => ({
    phase: 'idle',
    sessionType: 'focus',
    intention: '',
    category,
    targetMs: settings.focusDuration * 60000,
    remainingMs: settings.focusDuration * 60000,
    overflowMs: 0,
    startedAt: null,
    pausedAt: null,
    todoistTaskId: null,
  }), [category, settings.focusDuration])

  const returnToIdle = useCallback(() => {
    setPhase('idle')
    setSessionType('focus')
    setTypeKey('focus')
    setTargetMs(settings.focusDuration * 60000)
    setRemainingMs(settings.focusDuration * 60000)
    setStartedAt(0)
  }, [settings.focusDuration])

  const makeDraft = useCallback((natural: boolean): ReflectionDraft | null => {
    if (!startedAt) return null
    const endedAt = Date.now()
    if (natural) {
      return makeCompletedDraft({
        startedAt,
        endedAt,
        targetMs,
        intention,
        category,
        sessionType,
        todoistTaskId: taskRefValue,
      })
    }
    const actualMs = Math.max(60000, endedAt - startedAt)
    return {
      id: `manual-${startedAt}`,
      intention,
      category,
      type: sessionType,
      targetMs,
      actualMs,
      overflowMs: Math.max(0, actualMs - targetMs),
      startedAt,
      endedAt,
      todoistTaskId: taskRefValue,
    }
  }, [category, intention, sessionType, startedAt, targetMs, taskRefValue])

  const finish = useCallback((natural: boolean) => {
    if (finishingRef.current) return
    finishingRef.current = true
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (sessionType === 'break') {
      clearTimerState()
      if (natural) {
        if (settings.soundEnabled) playChime(660)
        if (navigator.vibrate) navigator.vibrate(120)
        if (settings.autoStartFocus) {
          finishingRef.current = false
          start('focus', '', category, [])
          return
        }
      }
      returnToIdle()
      syncToServer(idleServerState())
      postSwMessage('TIMER_STOPPED')
      finishingRef.current = false
      return
    }
    const nextDraft = makeDraft(natural)
    if (!nextDraft) {
      finishingRef.current = false
      return
    }
    setDraft(nextDraft)
    setRating(null)

    // The cycle advances when the focus session ends, not when its rating is
    // saved — the break that follows needs to know whether it is a long one.
    const nextCount = incrementPomodoroCycle()
    setCycleCount(nextCount)

    if (settings.soundEnabled) playChime(880)
    if (navigator.vibrate) navigator.vibrate([160, 80, 160])

    /*
     * Rest starts the moment focus ends. Waiting for the rating to be saved
     * meant the break only began once you had answered and pressed a button —
     * so the rest you were owed quietly started late, or not at all if you
     * walked away. The poster now rides on top of the running break instead of
     * gating it.
     */
    if (settings.autoStartBreak) {
      // Record it now, before the rating is answered. The poster is no longer
      // a wall you have to get past — you are on a break and may simply walk
      // away — and a focus session that happened should not depend on that.
      // Saving the rating later re-posts the same id, which upserts.
      void fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nextDraft, notes: '', rating: 0 }),
      }).catch(() => {})

      const isLongBreak = nextCount % settings.sessionsBeforeLongBreak === 0
      finishingRef.current = false
      start('break', '', category, [], isLongBreak ? settings.longBreakDuration : settings.breakDuration)
      return
    }

    setPhase('reflect')
    clearTimerState()
    syncToServer(idleServerState())
    postSwMessage('TIMER_STOPPED')
    finishingRef.current = false
  }, [category, idleServerState, makeDraft, postSwMessage, returnToIdle, sessionType, settings.autoStartBreak, settings.autoStartFocus, settings.breakDuration, settings.longBreakDuration, settings.sessionsBeforeLongBreak, settings.soundEnabled, start, syncToServer])

  /**
   * End the sitting without recording it. Distinct from Finish: abandoning
   * says the session did not happen, so nothing is logged and no minutes are
   * written back to a task.
   */
  const abandon = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    clearTimerState()
    setDraft(null)
    setRating(null)
    setIntention('')
    setTaskRefs([])
    returnToIdle()
    syncToServer(idleServerState())
    postSwMessage('TIMER_STOPPED')
  }, [idleServerState, postSwMessage, returnToIdle, syncToServer])

  /**
   * A break that reaches zero keeps counting up, exactly like focus — resting
   * longer than planned is a normal thing to do, and the old behaviour ended
   * the break out from under you. Auto-start focus is the one exception: it is
   * a standing instruction to move on the moment the break is over.
   */
  useEffect(() => {
    if (phase !== 'running' || sessionType !== 'break' || remainingMs > 0) return
    if (settings.autoStartFocus) finish(true)
  }, [finish, phase, remainingMs, sessionType, settings.autoStartFocus])

  // Chime once the moment a running session crosses zero, then let it run into
  // overtime. Only fires on a live tick across zero — restoring an
  // already-overdue session from the server stays silent.
  useEffect(() => {
    const prev = prevRemainingRef.current
    prevRemainingRef.current = remainingMs
    if (phase !== 'running') return
    if (prev === null || prev <= 0 || remainingMs > 0) return
    // The auto-start path ends the break here and chimes on its own.
    if (sessionType === 'break' && settings.autoStartFocus) return
    if (settings.soundEnabled) playChime(sessionType === 'focus' ? 880 : 660)
    if (navigator.vibrate) navigator.vibrate([160, 80, 160])
  }, [phase, remainingMs, sessionType, settings.autoStartFocus, settings.soundEnabled])

  /**
   * Record time against every task the session was pointed at. Each stored
   * reference carries its provider, so a Things task never gets sent to
   * Todoist — and a provider switched off since the session started is left
   * alone rather than called behind the person's back.
   *
   * The session's minutes go to each task in full: sesh knows how long the
   * sitting was, not how it was divided, and splitting it evenly would be a
   * guess dressed up as a measurement.
   *
   * Nothing is ticked off. Finishing a session says the sitting is over, not
   * that the work is. Completing a task is a deliberate tap on its checkbox.
   *
   * A write that fails is queued rather than lost: the minutes are real
   * whether or not the network agreed at that moment.
   */
  const syncTasksAfterSession = async (taskRefValues: string | null, actualMs: number) => {
    const refs = decodeTaskRefs(taskRefValues).filter(ref => providers.includes(ref.provider))
    if (refs.length === 0) return

    const minutes = actualMs / 60000
    const failures: string[] = []
    await Promise.all(refs.map(async ref => {
      try {
        await recordFocusTime(ref.provider, ref.id, minutes)
      } catch (err) {
        enqueueFocusTime({ taskRef: encodeTaskRef(ref.provider, ref.id), minutes, queuedAt: Date.now() })
        failures.push(err instanceof Error ? err.message : `Failed to reach ${PROVIDER_LABEL[ref.provider]}`)
      }
    }))
    setTaskNotice(failures.length > 0 ? `${failures.join(' · ')} — will retry` : null)
  }

  const saveSession = async (ratingValue: number) => {
    if (!draft) return
    const session = { ...draft, notes: '', rating: ratingValue }
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      })
      if (!res.ok) throw new Error('Failed to save session')
      void syncTasksAfterSession(draft.todoistTaskId, draft.actualMs)
    } catch {
      const offline: QueuedSession = { ...session, queuedAt: Date.now() }
      enqueueSession(offline)
    }

    setDraft(null)
    setRating(null)

    // The break is already running underneath: clearing the draft just puts the
    // poster away, leaving the rest exactly where it had got to.
    if (live) return

    setIntention('')
    setTaskRefs([])
    setStartedAt(0)
    returnToIdle()
  }

  // ── Derived copy ───────────────────────────────────────────────────────

  const draftTasks = useMemo(() => {
    const byRef = new Map(tasks.map(task => [encodeTaskRef(resolveProvider(task), task.id), task]))
    return draftRefs.map(ref => byRef.get(ref)).filter((task): task is ExternalTask => !!task)
  }, [draftRefs, tasks])

  const linkedTasks = selectedTasks
    .map(entry => entry.task)
    .filter((task): task is ExternalTask => task !== null)
  const leadTask = linkedTasks[0] ?? null
  const leadProvider = leadTask ? resolveProvider(leadTask) : null

  const taskSlotLabel = leadTask && leadProvider
    ? `${PROVIDER_LABEL[leadProvider]} · ${leadTask.projectName ?? PROVIDER_LABEL[leadProvider]}`
    : taskRefs.length > 0 ? `${taskRefs.length} linked` : 'No task linked'
  const taskSlotTitle = linkedTasks.length > 0
    ? linkedTasks.map(t => t.content).join(' · ')
    : taskRefs.length > 0 ? 'Linked task unavailable' : 'Focus without a task'

  const clockSub = live
    ? (phase === 'paused' ? 'Paused' : isOvertime ? 'Overtime' : 'Remaining')
    : `${idleDurationMinutes} min planned`
  const phaseLabel = phase === 'paused'
    ? 'Paused'
    : isOvertime ? 'Overtime' : `${typeLabel} · ${pad2(sessionNo)}`
  const liveMeta = leadTask && leadProvider
    ? `${PROVIDER_LABEL[leadProvider]} · ${leadTask.projectName ?? PROVIDER_LABEL[leadProvider]} · logging to task`
    : 'No task linked'

  // The desktop header's subtitle. Reported rather than lifted, so the shell
  // stays a shell.
  useEffect(() => {
    // The screen already carries the session number and date in its eyebrow,
    // so the header says only what the screen does not: the planned length.
    reportSub('timer', live
      ? 'Session in progress'
      : `${clockOf(idleDurationMinutes * 60)} planned`)
  }, [idleDurationMinutes, live, reportSub])

  // ── The queue, capped ──────────────────────────────────────────────────

  const rowFor = useCallback((task: ExternalTask): TaskRowModel => {
    const provider = resolveProvider(task)
    const key = encodeTaskRef(provider, task.id)
    return {
      key,
      title: task.content,
      project: task.projectName ?? PROVIDER_LABEL[provider],
      due: task.dueLabel ?? '',
      est: estimateLabel(task),
      dot: PROVIDER_COLOR[provider],
      selected: activeRefs.includes(key),
      completing: completingKey === key,
      ariaLabel: activeRefs.includes(key)
        ? `Remove ${task.content} from the session`
        : `Add ${task.content} to the session`,
      onPick: () => toggleTaskRef(task),
      onFocus: () => focusOneTask(task),
      onComplete: () => { void completeOne(task) },
    }
  }, [activeRefs, completeOne, completingKey, focusOneTask, toggleTaskRef])

  const queueGroups: CappedGroup<TaskRowModel>[] = useMemo(() => {
    const scoped = tasks.filter(task => inScope(task, scope))
    const label = SCOPES.find(s => s.key === scope)?.label ?? 'All open'
    return capGroups([{ label, rows: scoped.map(rowFor) }], phone ? 6 : 7)
  }, [phone, rowFor, scope, tasks])

  const showTaskRail = !phone && !live

  // ── Render ─────────────────────────────────────────────────────────────

  const focusPad = phone ? '16px 18px 22px' : '20px 26px 20px'

  /**
   * Overlays mount into the shell, not the pane. A sheet whose scrim stopped
   * above the tab bar would leave the navigation lit and tappable underneath
   * it, and the poster is meant to be full-bleed.
   */
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setOverlayHost(document.getElementById('sesh-main') ?? document.body)
  }, [])
  const overlay = (node: React.ReactNode) => (overlayHost ? createPortal(node, overlayHost) : null)

  const centreReadout = (
    <>
      <span
        key={dragMinutes !== null ? idleDurationMinutes : 'steady'}
        className={dragMinutes !== null ? 'md-numpop' : undefined}
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 500,
          fontSize: clockSize,
          letterSpacing: '-.05em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {live ? clockOf(Math.ceil(remainingMs / 1000)) : clockOf(idleDurationMinutes * 60)}
      </span>
      <span
        style={{
          fontSize: Math.max(11, 12 * dialScale),
          color: 'var(--color-text-2)',
          fontWeight: 500,
          marginTop: 6,
        }}
      >
        {clockSub}
      </span>
      {overflowSec > 0 && (
        <span
          className="md-pulse md-num"
          style={{
            marginTop: 6,
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: Math.max(12, 13 * dialScale),
            color: 'var(--accent-base)',
          }}
        >
          +{clockOf(overflowSec)}
        </span>
      )}
    </>
  )

  return (
    <>
      <div className="md-screen">
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            padding: focusPad,
          }}
        >
          {idle ? (
            <div className="md-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="md-eyebrow">
                  Session {pad2(sessionNo)} · {new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
                <input
                  value={intention}
                  onChange={event => setIntention(event.target.value)}
                  onBlur={() => syncIdleTopic({ intention, category, refs: taskRefs })}
                  placeholder="What are you working on?"
                  aria-label="Session intention"
                  className="md-underline"
                  style={{
                    width: '100%',
                    background: 'transparent',
                    color: 'inherit',
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    // Never below 16px on a phone, or iOS zooms the page on focus.
                    fontSize: phone ? 22 : 26,
                    letterSpacing: '-.02em',
                    padding: '0 0 8px',
                    outline: 'none',
                  }}
                />
              </div>

              <CategoryChips
                categories={sortedCategories}
                active={category}
                phone={phone}
                dark={onDarkGround}
                onPick={name => {
                  setCategory(name)
                  setRecentCategories(markCategoryUsed(name))
                  syncIdleTopic({ intention, category: name, refs: taskRefs })
                }}
              />

              <div className="md-seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <span
                  aria-hidden="true"
                  className="md-seg-thumb"
                  style={{
                    left: `calc(3px + (100% - 6px) * ${['focus', 'short', 'long'].indexOf(typeKey)} / 3)`,
                    width: 'calc((100% - 6px) / 3)',
                  }}
                />
                {(['focus', 'short', 'long'] as TypeKey[]).map(key => (
                  <button
                    key={key}
                    type="button"
                    data-active={typeKey === key ? 'true' : 'false'}
                    aria-pressed={typeKey === key}
                    onClick={() => selectType(key)}
                    style={{
                      padding: '7px 10px',
                      fontSize: 13,
                      textAlign: 'left',
                      lineHeight: 1.2,
                    }}
                  >
                    {key === 'focus' ? 'Focus' : key === 'short' ? 'Short break' : 'Long break'}
                    <span className="md-num" style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-2)', marginTop: 2, letterSpacing: 0 }}>
                      {settings[durationKeyFor(key)]} min
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 'none' }}>
              <div className="md-rise" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="md-eyebrow" style={{ color: 'var(--accent-base)' }}>
                  {phaseLabel}
                </span>
                <span style={{ height: 1, flex: 1, background: 'var(--line)' }} />
                <span className="md-meta">
                  {selectedCategory?.label ?? 'Focus'}
                </span>
              </div>
              {/* Styled as the design's title line, but editable: rewriting
                  what you are working on mid-session is worth keeping, and a
                  borderless field looks identical to the text it replaces. */}
              <input
                value={intention}
                onChange={event => setIntention(event.target.value)}
                onBlur={event => changeRunningTopic(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                placeholder={isFocus ? 'Untitled session' : typeLabel}
                aria-label="Session topic"
                className="md-rise"
                style={{
                  width: '100%',
                  margin: 0,
                  border: 0,
                  background: 'transparent',
                  color: 'inherit',
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 700,
                  fontSize: phone ? 22 : 26,
                  lineHeight: 1.12,
                  letterSpacing: '-.02em',
                  padding: 0,
                  outline: 'none',
                }}
              />
              <span className="md-meta md-rise">
                {liveMeta}
              </span>
            </div>
          )}

          {/* The one elastic row: the dial takes whatever the fixed rows leave,
              which is what keeps the screen off a scrollbar on short phones. */}
          <div
            ref={dialFitRef}
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: phone ? '14px 0' : '4px 0',
            }}
          >
            <Dial
              size={dialSize}
              progress={progress}
              color={dialCol}
              live={live}
              elapsedSec={elapsedSec}
              darkGround={onDarkGround}
              dragging={dragMinutes !== null}
              ariaLabel={`${typeLabel} length dial`}
              onMinutesChange={idle ? setDragMinutes : undefined}
              onDragEnd={minutes => {
                setDragMinutes(null)
                commitIdleDuration(minutes)
              }}
            >
              {centreReadout}
            </Dial>
          </div>

          {idle ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 'auto', flex: 'none' }}>
              <div className="md-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px 10px 14px' }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="md-meta">
                    {taskSlotLabel}
                  </span>
                  <span
                    style={{
                      fontSize: 14.5,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {taskSlotTitle}
                  </span>
                </div>
                {phone && tasks.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-tonal btn-sm"
                    onClick={openSheet}
                    style={{ flex: 'none' }}
                  >
                    {taskRefs.length > 0 ? 'Change' : 'Choose'}
                  </button>
                )}
              </div>

              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => start()}
                style={{ width: '100%', minHeight: 52, justifyContent: 'space-between', fontSize: 16 }}
              >
                Start {typeLabel} · {idleDurationMinutes} min
                <MdIcon name="arrow" size={20} strokeWidth={2} color="var(--accent-on)" />
              </button>

              <span className="md-meta" style={{ textAlign: 'center' }}>
                Ends {endsAtLabel(Date.now(), idleDurationMinutes)} · drag the dial to change the length
              </span>

              {taskNotice && (
                <span style={{ fontSize: 12.5, color: 'var(--accent-base)', fontWeight: 600, textAlign: 'center' }}>{taskNotice}</span>
              )}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginTop: 'auto',
                flex: 'none',
                // Two buttons the width of a 1280px window are a bar, not a
                // pair; they sit under the dial at the dial's own width.
                width: '100%',
                maxWidth: phone ? 'none' : 560,
                alignSelf: 'center',
              }}
            >
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-tonal btn-lg md-rise"
                  aria-label={phase === 'paused' ? 'Resume session' : 'Pause session'}
                  onClick={() => (phase === 'paused' ? resume() : pause())}
                  style={{ flex: 1, minHeight: 52, gap: 9 }}
                >
                  <MdIcon name={phase === 'paused' ? 'play' : 'pause'} size={17} strokeWidth={2} />
                  {phase === 'paused' ? 'Resume' : 'Pause'}
                </button>
                {/*
                  * Paper, not more accent. The ground is the category's own
                  * colour taken all the way down, so an accent fill here would
                  * be the same hue at a near value and the screen would read
                  * as one note. Ink-on-ground is the one bright element in the
                  * room — the thing you can press without thinking.
                  */}
                <button
                  type="button"
                  className="btn btn-ink btn-lg md-rise"
                  aria-label="Finish session"
                  onClick={() => finish(false)}
                  style={{ flex: 1, minHeight: 52, gap: 9 }}
                >
                  <MdIcon name="check" size={17} strokeWidth={2.2} color="var(--color-bg)" />
                  Finish
                </button>
              </div>
              <button
                type="button"
                className="btn btn-quiet btn-sm md-rise"
                onClick={abandon}
                style={{ alignSelf: 'center' }}
              >
                Abandon session
              </button>
            </div>
          )}
        </div>

        {showTaskRail && (
          <>
          <ResizeHandle
            label="Queue width"
            width={queue.width}
            min={QUEUE_BOUNDS.min}
            max={QUEUE_BOUNDS.max}
            dragging={queue.dragging}
            towards="end"
            onStart={queue.startDrag}
            onNudge={queue.nudge}
            onReset={queue.reset}
          />
          <div
            style={{
              flex: 'none',
              width: queue.width,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              className="md-rule-b"
              style={{
                padding: '16px 16px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <h3 className="md-title" style={{ margin: 0, fontSize: 15 }}>
                  Queue
                </h3>
                <span className="md-meta md-num" style={{ marginLeft: 'auto', letterSpacing: 0 }}>
                  {tasks.length} open
                </span>
              </div>
              <ScopeChips scope={scope} onChange={setScope} />
            </div>
            {canCompose && <TaskComposer scope={scope} onCreated={refreshTasks} compact />}
            <TaskList groups={queueGroups} />
          </div>
          </>
        )}
      </div>

      {sheet && overlay(
        <div
          className="md-sheet-root"
          data-closing={sheetClosing ? 'true' : 'false'}
          role="dialog"
          aria-modal="true"
          aria-label="Choose a task"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 90,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={closeSheet}
            aria-label="Close"
            style={{
              position: 'absolute',
              inset: 0,
              border: 0,
              background: 'color-mix(in srgb, #161514 56%, transparent)',
              cursor: 'pointer',
            }}
          />
          <div
            className="md-sheet"
            style={{
              position: 'relative',
              maxHeight: '82%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span aria-hidden="true" className="md-grabber" />
            <div
              className="md-rule-b"
              style={{
                padding: '8px 16px 12px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <h3 className="md-title" style={{ margin: 0, fontSize: 17 }}>
                Choose a task
              </h3>
              <button
                type="button"
                className="btn btn-icon md-press-sm"
                onClick={closeSheet}
                aria-label="Close task picker"
                style={{ marginLeft: 'auto' }}
              >
                <MdIcon name="close" size={16} strokeWidth={2} />
              </button>
            </div>
            <div style={{ padding: '10px 16px', display: 'flex', gap: 6 }}>
              <ScopeChips scope={scope} onChange={setScope} />
            </div>
            {canCompose && <TaskComposer scope={scope} onCreated={refreshTasks} compact />}
            <div className="md-scroll">
              <TaskList groups={queueGroups} />
            </div>
          </div>
        </div>,
      )}

      {draft && overlay(
        <Poster
          minutes={Math.max(1, Math.round(draft.actualMs / 60000))}
          categoryLabel={categoryByName(categories, draft.category)?.label ?? 'Focus'}
          intention={draft.intention}
          onIntentionChange={next => setDraft(prev => (prev ? { ...prev, intention: next } : prev))}
          tasks={draftTasks}
          canPickTask={tasks.length > 0}
          onPickTask={openSheet}
          mirrorsToCalendar={settings.calendarSync}
          breakRunning={live}
          breakMinutes={nextBreakMinutes}
          phone={phone}
          rating={rating}
          onRate={setRating}
          onDone={next => {
            // The rating goes with the session either way; the button only
            // decides where the person lands afterwards. Saving first means a
            // break started here replaces the finished sitting cleanly rather
            // than racing the write that records it.
            void saveSession(rating ?? 0).then(() => {
              if (next === 'break') start('break', '', category, [], nextBreakMinutes)
              if (next === 'focus') start('focus', '', category, [])
            })
          }}
        />,
      )}
    </>
  )
}

const RATINGS: { label: string; value: number }[] = [
  { label: 'Focused', value: 5 },
  { label: 'So-so', value: 3 },
  { label: 'Scattered', value: 1 },
]

/**
 * The session-complete poster: a full-bleed accent panel that says exactly
 * what was written back, and to which provider. It sits over whatever is
 * underneath — including a break that has already started — rather than
 * gating it.
 */
function Poster({
  minutes,
  categoryLabel,
  intention,
  onIntentionChange,
  tasks,
  canPickTask,
  onPickTask,
  mirrorsToCalendar,
  breakRunning,
  breakMinutes,
  phone,
  rating,
  onRate,
  onDone,
}: {
  minutes: number
  categoryLabel: string
  /** Editable: what the session ends up filed as is decided here, not before. */
  intention: string
  onIntentionChange: (next: string) => void
  tasks: ExternalTask[]
  canPickTask: boolean
  onPickTask: () => void
  mirrorsToCalendar: boolean
  /** Rest has already started underneath — say so, or the poster looks like a wall. */
  breakRunning: boolean
  /** How long the break on offer would run: short, or long if the cycle is up. */
  breakMinutes: number
  phone: boolean
  rating: number | null
  onRate: (value: number) => void
  onDone: (next: PosterNext) => void
}) {
  const lead = tasks[0] ?? null
  const leadProvider = lead ? PROVIDER_LABEL[resolveProvider(lead)] : null
  const others = tasks.length - 1
  const note = lead && leadProvider
    ? `+${minutes} min written back to “${lead.content}”${others > 0 ? ` and ${others} more` : ''} in ${leadProvider}.${mirrorsToCalendar ? ' Mirrored to Google Calendar.' : ''}`
    : `Logged to ${categoryLabel}. No task linked, so nothing was written back.`

  /*
   * Where to go next, said out loud.
   *
   * This used to be one button whose meaning depended on whether you had
   * rated — rate and it started another sitting, don't and it just closed.
   * The rating is a rating now; the destination is a button. The lead action
   * is rest, which is the whole point of the cycle, and the other two sit
   * under it rather than behind a guess.
   *
   * A break already running underneath changes the question: rest is not on
   * offer because it is already happening, so the lead becomes getting out of
   * its way.
   */
  const [leadAction, ...restActions]: { label: string; next: PosterNext }[] = breakRunning
    ? [
      { label: 'Back to the dial', next: 'idle' },
      { label: 'Skip to next focus', next: 'focus' },
    ]
    : [
      { label: `Start break · ${breakMinutes} min`, next: 'break' },
      { label: 'Next focus', next: 'focus' },
      { label: 'Back to the dial', next: 'idle' },
    ]

  const onTone = { color: 'var(--accent-on)' }
  const quietOnAccent: React.CSSProperties = {
    ...onTone,
    background: 'transparent',
    border: `1px solid ${RULE_ON_ACCENT}`,
  }

  return (
    <div
      className="md-poster"
      role="dialog"
      aria-modal="true"
      aria-label="Session logged"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 80,
        background: 'var(--accent-base)',
        color: 'var(--accent-on)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'hidden',
        padding: phone ? 'calc(var(--safe-t) + 22px) 22px calc(var(--safe-b) + 22px)' : '40px 40px 36px',
      }}
    >
      <div style={{ width: '100%', maxWidth: phone ? 'none' : 460, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-on)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path className="md-draw" d="M4 12.5 9.5 18 20 6" />
          </svg>
          <span className="md-eyebrow" style={{ ...onTone, opacity: .85 }}>
            Session logged
          </span>
        </div>

        <span
          className="md-num"
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 500,
            fontSize: phone ? 'min(96px, 14vh)' : 'min(120px, 17vh)',
            letterSpacing: '-.04em',
            lineHeight: .95,
            marginTop: phone ? 22 : 28,
          }}
        >
          {minutes}
        </span>
        <span style={{ fontSize: 15, fontWeight: 500, opacity: .85, marginTop: 4 }}>
          minutes · {categoryLabel}
        </span>

        {/* What it gets filed as is still open until you dismiss this. The field
            carries the poster's own ink rather than a box, so it reads as the
            title it is. */}
        <input
          value={intention}
          onChange={event => onIntentionChange(event.target.value)}
          placeholder="Untitled session"
          aria-label="What this session was"
          className="md-on-accent"
          style={{
            width: '100%',
            marginTop: 22,
            border: 0,
            borderBottom: `1px solid ${RULE_ON_ACCENT}`,
            borderRadius: 0,
            background: 'transparent',
            color: 'var(--accent-on)',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: phone ? 19 : 22,
            letterSpacing: '-.02em',
            padding: '0 0 9px',
            outline: 'none',
          }}
        />

        <div style={{ background: FILL_ON_ACCENT, borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '10px 8px 10px 14px' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, opacity: .8 }}>
              {lead && leadProvider ? `${leadProvider} · ${lead.projectName ?? leadProvider}` : 'No task linked'}
            </span>
            <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tasks.length > 0 ? tasks.map(t => t.content).join(' · ') : 'Nothing written back'}
            </span>
          </div>
          {canPickTask && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onPickTask}
              // The idle slot behind the poster carries the same word, so this
              // one says which task it means.
              aria-label={tasks.length > 0 ? 'Change the task this session is filed against' : 'Choose a task for this session'}
              style={{ flex: 'none', background: FILL_ON_ACCENT, ...onTone }}
            >
              {tasks.length > 0 ? 'Change' : 'Choose'}
            </button>
          )}
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 14, lineHeight: 1.5, maxWidth: '38ch', opacity: .88, textWrap: 'pretty' }}>
          {note}
        </p>
        {breakRunning && (
          <p style={{ margin: '8px 0 0', fontSize: 13.5, fontWeight: 600, opacity: .88 }}>
            Your break is already running.
          </p>
        )}

        <div style={{ marginTop: 'auto', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="md-eyebrow" style={{ ...onTone, opacity: .8 }}>
            How did it go?
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {RATINGS.map(({ label, value }) => (
              <button
                key={label}
                type="button"
                className="btn btn-md"
                aria-pressed={rating === value}
                onClick={() => onRate(value)}
                style={{
                  flex: 1,
                  background: rating === value ? 'var(--accent-on)' : FILL_ON_ACCENT,
                  color: rating === value ? 'var(--accent-base)' : 'var(--accent-on)',
                  transition: 'background 180ms, color 180ms, transform 120ms',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-lg"
            onClick={() => onDone(leadAction.next)}
            style={{
              width: '100%',
              minHeight: 52,
              justifyContent: 'space-between',
              background: 'var(--accent-on)',
              color: 'var(--accent-base)',
              fontSize: 16,
              marginTop: 6,
            }}
          >
            {leadAction.label}
            <MdIcon name="arrow" size={20} strokeWidth={2} />
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {restActions.map(action => (
              <button
                key={action.next}
                type="button"
                className="btn btn-md"
                onClick={() => onDone(action.next)}
                style={{ flex: 1, ...quietOnAccent }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
