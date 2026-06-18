'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Category, CategoryRecord, SessionType, TodoistTask } from '@/types'
import { useSettings } from '@/context/SettingsContext'
import { useCategories } from '@/context/CategoriesContext'
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock'
import { ensurePushSubscription, isInstalledPwa } from '@/lib/push-client'
import { clearTimerState, enqueueSession, getRecentCategoryNames, loadTimerState, markCategoryUsed, saveTimerState, type QueuedSession } from '@/lib/local-store'
import { isAuthResponse, readApiError } from '@/lib/api-client'
import { Btn, Chip, Icon, Ring, Seg, Sheet, fmtClock, fmtHM, tint } from './sesh-ui'
import type { PendingFocus } from './Tasks'

type TimerRunPhase = 'idle' | 'running' | 'paused' | 'reflect'

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

function ratingWord(rating: number) {
  return ['', 'Tough', 'Slow', 'Okay', 'Good', 'Flow'][rating] || ''
}

const DURATION_LIMITS = {
  focus: { min: 5, max: 60, step: 5 },
  break: { min: 1, max: 30, step: 1 },
} as const

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatEndTime(epochMs: number) {
  return new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(epochMs))
}

function durationBounds(sessionType: SessionType) {
  return DURATION_LIMITS[sessionType]
}

function snapDurationMinutes(minutes: number, sessionType: SessionType) {
  const bounds = durationBounds(sessionType)
  const snapped = Math.round((minutes - bounds.min) / bounds.step) * bounds.step + bounds.min
  return clamp(snapped, bounds.min, bounds.max)
}

function dialProgressToMinutes(progress: number, sessionType: SessionType) {
  const bounds = durationBounds(sessionType)
  const raw = clamp(progress, 0, 1) * bounds.max
  return snapDurationMinutes(raw, sessionType)
}

function minutesToDialProgress(minutes: number, sessionType: SessionType) {
  const bounds = durationBounds(sessionType)
  return clamp(minutes / bounds.max, 0, 1)
}

function pointerToDialProgress(clientX: number, clientY: number, rect: DOMRect | { left: number; top: number; width: number; height: number }) {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const angle = ((Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90 + 360) % 360
  return angle / 360
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

function taskCategory(task: TodoistTask, categories: CategoryRecord[], fallback: string): string {
  const candidates = [task.category, ...(task.labels ?? [])].filter(Boolean).map(value => String(value).toLowerCase())
  for (const candidate of candidates) {
    const found = categories.find(category => category.name.toLowerCase() === candidate || category.label.toLowerCase() === candidate)
    if (found) return found.name
  }
  return fallback
}

function TaskPickerSheet({
  open,
  onClose,
  onPick,
  activeId,
  categories,
  fallbackCategory,
}: {
  open: boolean
  onClose: () => void
  onPick: (task: TodoistTask, categoryName: string) => void
  activeId: string | null
  categories: CategoryRecord[]
  fallbackCategory: string
}) {
  const [tasks, setTasks] = useState<TodoistTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/api/todoist/tasks?filter=all')
      .then(async res => {
        if (!res.ok) throw new Error(await readApiError(res, 'Failed to load Todoist tasks'))
        return res.json()
      })
      .then(data => { if (!cancelled) setTasks((data.tasks ?? []).filter((task: TodoistTask) => !task.completed)) })
      .catch(err => {
        if (!cancelled) {
          setTasks([])
          setError(err instanceof Error ? err.message : 'Failed to load Todoist tasks')
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  const today = tasks.filter(task => task.due === 'today')
  const tomorrow = tasks.filter(task => task.due === 'tomorrow')
  const upcoming = tasks.filter(task => task.due === 'upcoming')
  const someday = tasks.filter(task => !task.due)
  const boardColumns = [
    { key: 'tomorrow', label: 'Tomorrow', items: tomorrow },
    { key: 'upcoming', label: 'Upcoming', items: upcoming },
    { key: 'someday', label: 'No date', items: someday },
  ].filter(column => column.items.length > 0)

  return (
    <Sheet open={open} onClose={onClose} title="Focus on a task">
      <div className="flex max-h-[420px] flex-col gap-[14px] overflow-y-auto">
        {loading && <div className="px-0.5 py-4 text-[14px] text-[var(--ink-3)]">Loading Todoist...</div>}
        {error && <div className="rounded-[var(--r-md)] border border-[#C2615A]/20 bg-[#C2615A]/10 px-4 py-3 text-[13px] text-[#C2615A]">{error}</div>}
        <TaskGroup label="Today" items={today} categories={categories} activeId={activeId} fallbackCategory={fallbackCategory} onPick={onPick} />
        {boardColumns.length > 0 && (
          <TaskBoard columns={boardColumns} categories={categories} activeId={activeId} fallbackCategory={fallbackCategory} onPick={onPick} />
        )}
        {!loading && tasks.length === 0 && <div className="px-0.5 py-4 text-[14px] text-[var(--ink-3)]">All caught up. Nothing left in Todoist.</div>}
      </div>
    </Sheet>
  )
}

function TaskBoard({
  columns,
  categories,
  activeId,
  fallbackCategory,
  onPick,
}: {
  columns: { key: string; label: string; items: TodoistTask[] }[]
  categories: CategoryRecord[]
  activeId: string | null
  fallbackCategory: string
  onPick: (task: TodoistTask, categoryName: string) => void
}) {
  return (
    <div>
      <div className="mb-[9px] text-[12px] uppercase tracking-[0.07em] text-[var(--ink-3)]">Upcoming board</div>
      <div className="hide-scrollbar -mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex min-w-max gap-3">
          {columns.map(column => (
            <div key={column.key} className="flex w-[220px] flex-col rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[var(--ink-2)]">{column.label}</span>
                <span className="rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ink-3)]">{column.items.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {column.items.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    categories={categories}
                    activeId={activeId}
                    fallbackCategory={fallbackCategory}
                    onPick={onPick}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TaskCard({
  task,
  categories,
  activeId,
  fallbackCategory,
  onPick,
}: {
  task: TodoistTask
  categories: CategoryRecord[]
  activeId: string | null
  fallbackCategory: string
  onPick: (task: TodoistTask, categoryName: string) => void
}) {
  const categoryName = taskCategory(task, categories, fallbackCategory)
  const category = categoryByName(categories, categoryName)
  const active = activeId === task.id
  const priorityLabel = task.priority > 1 ? `P${task.priority}` : null

  return (
    <button
      type="button"
      onClick={() => onPick(task, categoryName)}
      className="flex items-center gap-3 rounded-[var(--r-md)] border px-[14px] py-3 text-left"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--line)',
        borderWidth: active ? 1.5 : 1,
        background: active ? 'var(--accent-soft)' : 'var(--surface)',
      }}
    >
      <span className="h-4 w-4 flex-shrink-0 rounded-full border-2" style={{ borderColor: category?.color ?? 'var(--line-strong)' }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{task.content}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[12.5px] text-[var(--ink-3)]">
          <span className="truncate">{task.projectName ?? 'Todoist'}</span>
          {priorityLabel && <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--ink-2)]">{priorityLabel}</span>}
        </span>
      </span>
      {category && <span className="h-2 w-2 rounded-full" style={{ background: category.color }} />}
    </button>
  )
}

function TaskGroup({
  label,
  items,
  categories,
  activeId,
  fallbackCategory,
  onPick,
}: {
  label: string
  items: TodoistTask[]
  categories: CategoryRecord[]
  activeId: string | null
  fallbackCategory: string
  onPick: (task: TodoistTask, categoryName: string) => void
}) {
  if (!items.length) return null
  return (
    <div>
      <div className="mb-[9px] text-[12px] uppercase tracking-[0.07em] text-[var(--ink-3)]">{label}</div>
      <div className="flex flex-col gap-2">
        {items.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            categories={categories}
            activeId={activeId}
            fallbackCategory={fallbackCategory}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  )
}

function IntentionSheet({
  open,
  intention,
  onClose,
  onSave,
}: {
  open: boolean
  intention: string
  onClose: () => void
  onSave: (value: string) => void
}) {
  const [value, setValue] = useState(intention)
  useEffect(() => { if (open) setValue(intention) }, [open, intention])

  return (
    <Sheet open={open} onClose={onClose} title="Focus intention">
      <textarea
        autoFocus
        value={value}
        onChange={event => setValue(event.target.value)}
        rows={2}
        placeholder="e.g. Draft the Q3 strategy memo — optional"
        className="w-full resize-none rounded-[var(--r-md)] border-[1.5px] border-[var(--line-strong)] bg-[var(--surface)] px-4 py-[14px] text-[18px] font-semibold leading-snug tracking-[-0.02em] text-[var(--ink)] outline-none"
      />
      <p className="mx-0.5 mb-0 mt-3 text-[13px] leading-normal text-[var(--ink-3)]">A one-line focus for this session. Leave it blank to just track the category.</p>
      <div className="mt-[22px]">
        <Btn full size="lg" onClick={() => onSave(value.trim())}>{value.trim() ? 'Set intention' : 'Continue without one'}</Btn>
      </div>
    </Sheet>
  )
}

function Reflection({
  draft,
  category,
  onSave,
  onSkip,
}: {
  draft: ReflectionDraft
  category: CategoryRecord | null
  onSave: (rating: number, notes: string) => void
  onSkip: () => void
}) {
  const [rating, setRating] = useState(4)
  const [notes, setNotes] = useState('')
  const accent = category?.color ?? 'var(--accent)'

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto px-[26px] pb-[calc(22px+var(--safe-b))] pt-[calc(42px+var(--safe-t))]">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-[22px]">
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-[58px] w-[58px] place-items-center rounded-full" style={{ background: tint(accent, 16) }}>
            <Icon name="check" size={32} color={accent} stroke={2} />
          </div>
          <h1 className="m-0 font-[var(--font-display)] text-[27px] font-bold tracking-[-0.035em]">Session complete</h1>
          <p className="mb-0 mt-[10px] text-[16px] text-[var(--ink-2)]">
            {fmtHM(draft.actualMs / 60000)} on <strong className="font-semibold text-[var(--ink)]">{category?.label ?? 'Focus'}</strong>
            {draft.intention ? <><br />&ldquo;{draft.intention}&rdquo;</> : null}
          </p>
        </div>

        <div>
          <div className="mb-[14px] text-center text-[13px] tracking-[0.02em] text-[var(--ink-3)]">How did it feel?</div>
          <div className="flex justify-center gap-[10px]">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className="h-[46px] w-[46px] rounded-full border-0 text-[15px] font-bold transition-transform"
                style={{
                  background: n <= rating ? accent : 'var(--surface-2)',
                  color: n <= rating ? '#fff' : 'var(--ink-3)',
                  transform: n === rating ? 'scale(1.12)' : 'scale(1)',
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mt-3 h-[18px] text-center text-[14px] font-semibold" style={{ color: accent }}>{ratingWord(rating)}</div>
        </div>

        <div>
          <div className="mb-[9px] text-[13px] tracking-[0.02em] text-[var(--ink-3)]">What did you get done?</div>
          <textarea
            value={notes}
            onChange={event => setNotes(event.target.value)}
            rows={3}
            placeholder="A line for your future self..."
            className="w-full resize-none rounded-[var(--r-md)] border-[1.5px] border-[var(--line-strong)] bg-[var(--surface)] px-4 py-[14px] text-[16px] leading-normal text-[var(--ink)] outline-none"
          />
        </div>
      </div>

      <div className="mt-5 grid flex-shrink-0 grid-cols-[1fr_auto] gap-3">
        <Btn full size="lg" onClick={() => onSave(rating, notes)}>Save to journal</Btn>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-[var(--r-pill)] border-0 bg-[var(--surface-2)] px-5 text-[16px] font-semibold text-[var(--ink-2)]"
        >
          Skip
        </button>
      </div>
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
  const { settings, updateSettings } = useSettings()
  const { categories, byName } = useCategories()
  const [phase, setPhase] = useState<TimerRunPhase>('idle')
  const [sessionType, setSessionType] = useState<SessionType>('focus')
  const [intention, setIntention] = useState('')
  const [category, setCategory] = useState<Category>('')
  const [remainingMs, setRemainingMs] = useState(settings.focusDuration * 60000)
  const [targetMs, setTargetMs] = useState(settings.focusDuration * 60000)
  const [dragMinutes, setDragMinutes] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [todoistTaskId, setTodoistTaskId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'intention' | 'tasks' | null>(null)
  const [recentCategories, setRecentCategories] = useState<string[]>([])
  const [todoistOpenCount, setTodoistOpenCount] = useState(0)
  const [todoistNotice, setTodoistNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<ReflectionDraft | null>(null)
  const [streak, setStreak] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const finishingRef = useRef(false)
  const dragFrameRef = useRef<number | null>(null)
  const dragMinutesRef = useRef<number | null>(null)

  const wakeLock = useScreenWakeLock(settings.keepScreenAwake && phase === 'running')

  useEffect(() => {
    onImmersive?.(phase === 'running' || phase === 'paused' || phase === 'reflect')
  }, [onImmersive, phase])

  useEffect(() => {
    setRecentCategories(getRecentCategoryNames())
    fetch('/api/analytics').then(res => res.ok ? res.json() : null).then(data => setStreak(data?.streak ?? 0)).catch(() => setStreak(0))
    fetch('/api/todoist/status')
      .then(async status => {
        if (isAuthResponse(status)) {
          setTodoistNotice('Todoist auth required. Sign in again to choose tasks.')
          return { tasks: [] }
        }
        if (!status.ok) {
          setTodoistNotice(await readApiError(status, 'Todoist status check failed'))
          return { tasks: [] }
        }
        const statusData = await status.json()
        if (!statusData.configured) return { tasks: [] }

        const res = await fetch('/api/todoist/tasks?filter=all')
        if (!res.ok) {
          setTodoistNotice(await readApiError(res, 'Failed to load Todoist tasks'))
          return { tasks: [] }
        }
        setTodoistNotice(null)
        return res.json()
      })
      .then(data => setTodoistOpenCount((data.tasks ?? []).filter((task: TodoistTask) => !task.completed).length))
      .catch(() => setTodoistOpenCount(0))
  }, [])

  useEffect(() => {
    if (categories.length === 0) return
    if (category && byName[category]) return
    const defaultCategory = categories.find(item => item.isDefault) ?? categories[0]
    setCategory(defaultCategory.name)
  }, [byName, categories, category])

  useEffect(() => {
    if (!pendingFocus) return
    setIntention(pendingFocus.intention)
    if (pendingFocus.category && byName[pendingFocus.category]) setCategory(pendingFocus.category)
    setTodoistTaskId(pendingFocus.taskId)
    setSessionType('focus')
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
      setIntention(data.intention)
      setCategory(data.category as Category)
      setTargetMs(data.targetMs)
      setStartedAt(data.startedAt)
      setTodoistTaskId(data.todoistTaskId)
      if (nextRemaining > 0) {
        setPhase('running')
        setRemainingMs(nextRemaining)
      } else if (data.sessionType === 'focus') {
        setPhase('running')
        setRemainingMs(nextRemaining)
      } else {
        setRemainingMs(settings.focusDuration * 60000)
        setPhase('idle')
      }
    } else if (data.phase === 'paused') {
      setPhase('paused')
      setSessionType(data.sessionType as SessionType)
      setIntention(data.intention)
      setCategory(data.category as Category)
      setRemainingMs(data.remainingMs)
      setTargetMs(data.targetMs)
      setStartedAt(data.startedAt ?? 0)
      setTodoistTaskId(data.todoistTaskId)
    } else if (data.phase === 'idle') {
      setPhase('idle')
      if (data.category) setCategory(data.category as Category)
      if (data.intention) setIntention(data.intention)
      setSessionType('focus')
      setTargetMs(settings.focusDuration * 60000)
      setRemainingMs(settings.focusDuration * 60000)
      setStartedAt(0)
    }
  }, [settings.focusDuration])

  const restoreLocal = useCallback(() => {
    const local = loadTimerState()
    if (!local) return
    setSessionType(local.sessionType as SessionType)
    setIntention(local.intention)
    setCategory(local.category)
    setTargetMs(local.targetMs)
    setTodoistTaskId(local.todoistTaskId)
    if (local.phase === 'running' && local.startedAt) {
      const nextRemaining = local.remainingMs - (Date.now() - local.savedAt)
      if (nextRemaining > 0) {
        setPhase('running')
        setRemainingMs(nextRemaining)
        setStartedAt(local.startedAt)
      } else if (local.sessionType === 'focus') {
        setPhase('running')
        setRemainingMs(nextRemaining)
        setStartedAt(local.startedAt)
      } else {
        setPhase('idle')
        setRemainingMs(Math.max(0, nextRemaining))
        setStartedAt(local.startedAt)
      }
    } else if (local.phase === 'paused') {
      setPhase('paused')
      setRemainingMs(local.remainingMs)
      setStartedAt(local.startedAt ?? 0)
    }
  }, [])

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
      todoistTaskId,
      savedAt: Date.now(),
    })
  }, [category, intention, phase, remainingMs, sessionType, startedAt, targetMs, todoistTaskId])

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
  }, [phase])

  useEffect(() => {
    return () => {
      if (dragFrameRef.current != null) {
        window.cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
      dragMinutesRef.current = null
    }
  }, [])

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

  const commitIdleDuration = useCallback((minutes: number, type: SessionType = sessionType) => {
    const nextMinutes = snapDurationMinutes(minutes, type)
    const nextTarget = nextMinutes * 60000

    if (type === 'focus') updateSettings({ focusDuration: nextMinutes })
    else updateSettings({ breakDuration: nextMinutes })

    setTargetMs(nextTarget)
    setRemainingMs(nextTarget)
    syncToServer({
      phase: 'idle',
      sessionType: type,
      intention,
      category,
      targetMs: nextTarget,
      remainingMs: nextTarget,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
      todoistTaskId,
    })
  }, [category, intention, sessionType, syncToServer, todoistTaskId, updateSettings])

  const handleIdleDialPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== 'idle') return

    const dial = event.currentTarget
    const rect = dial.getBoundingClientRect()
    const toMinutes = (clientX: number, clientY: number) => dialProgressToMinutes(pointerToDialProgress(clientX, clientY, rect), sessionType)
    const queueMinutes = (nextMinutes: number) => {
      dragMinutesRef.current = nextMinutes
      if (dragFrameRef.current != null) return
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null
        setDragMinutes(prev => (prev === dragMinutesRef.current ? prev : dragMinutesRef.current))
      })
    }

    event.preventDefault()
    if (typeof dial.setPointerCapture === 'function') {
      try { dial.setPointerCapture(event.pointerId) } catch {}
    }

    queueMinutes(toMinutes(event.clientX, event.clientY))

    const handleMove = (moveEvent: PointerEvent) => {
      queueMinutes(toMinutes(moveEvent.clientX, moveEvent.clientY))
    }

    const cleanup = () => {
      if (dragFrameRef.current != null) {
        window.cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
      dragMinutesRef.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', cancelDrag)
    }

    const finishDrag = (endEvent: PointerEvent) => {
      const finalMinutes = toMinutes(endEvent.clientX, endEvent.clientY)
      setDragMinutes(null)
      cleanup()
      commitIdleDuration(finalMinutes, sessionType)
    }

    const cancelDrag = () => {
      setDragMinutes(null)
      cleanup()
    }

    window.addEventListener('pointermove', handleMove, { passive: true })
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', cancelDrag)
  }, [commitIdleDuration, phase, sessionType])

  const isFocus = sessionType === 'focus'
  const idleBaseMinutes = Math.max(1, Math.round(targetMs / 60000)) || (isFocus ? settings.focusDuration : settings.breakDuration)
  const idleDurationMinutes = dragMinutes ?? idleBaseMinutes
  const idleDialProgress = minutesToDialProgress(idleDurationMinutes, sessionType)
  const isIdleDialDragging = dragMinutes !== null
  const totalMs = phase === 'idle' ? idleDurationMinutes * 60000 : targetMs || (sessionType === 'focus' ? settings.focusDuration : settings.breakDuration) * 60000
  const progress = phase === 'idle' ? 0 : Math.min(1, Math.max(0, 1 - (remainingMs / Math.max(totalMs, 1))))
  const idleDialTint = isFocus ? selectedCategory?.color ?? 'var(--accent)' : 'var(--ink)'
  const ringTint = isFocus ? selectedCategory?.color ?? 'var(--accent)' : 'var(--ink-3)'
  const remainingSec = phase === 'idle' ? idleDurationMinutes * 60 : Math.ceil(remainingMs / 1000)
  const compactCategoryLayout = sortedCategories.length > 5
  const idleRingSize = sortedCategories.length > 8 ? 208 : sortedCategories.length > 5 ? 220 : 236
  const runningRingSize = 280
  const idleClockLabel = isFocus ? 'Focus length' : 'Break length'
  const runningClockLabel = phase === 'paused'
    ? 'Paused'
    : remainingMs < 0
      ? 'Overtime'
      : isFocus
        ? 'Remaining'
        : 'Break remaining'
  const runningClockDetail = startedAt ? `Ends ${formatEndTime(startedAt + totalMs)}` : `${Math.round(totalMs / 60000)} min target`

  const selectSessionType = (next: SessionType) => {
    const nextTarget = (next === 'focus' ? settings.focusDuration : settings.breakDuration) * 60000
    setDragMinutes(null)
    setSessionType(next)
    setTargetMs(nextTarget)
    setRemainingMs(nextTarget)
    syncToServer({
      phase: 'idle',
      sessionType: next,
      intention,
      category,
      targetMs: nextTarget,
      remainingMs: nextTarget,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
      todoistTaskId,
    })
  }

  const start = useCallback((type: SessionType = sessionType, startingIntention = intention, startingCategory = category, startingTaskId = todoistTaskId) => {
    const configuredTarget = (type === 'focus' ? settings.focusDuration : settings.breakDuration) * 60000
    const nextTarget = phase === 'idle' && type === sessionType && targetMs > 0 ? targetMs : configuredTarget
    const now = Date.now()
    if (settings.keepScreenAwake) void wakeLock.request({ allowWhileInactive: true })
    if (type === 'focus') void ensurePushSubscription({ requestPermission: isInstalledPwa() }).catch(() => {})
    setPhase('running')
    setSessionType(type)
    setStartedAt(now)
    setTargetMs(nextTarget)
    setRemainingMs(nextTarget)
    setIntention(startingIntention)
    setCategory(startingCategory)
    setTodoistTaskId(startingTaskId)
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
      todoistTaskId: startingTaskId,
    })
    postSwMessage('TIMER_STARTED')
  }, [category, intention, phase, postSwMessage, sessionType, settings.breakDuration, settings.focusDuration, settings.keepScreenAwake, syncToServer, targetMs, todoistTaskId, wakeLock])

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
      todoistTaskId,
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
      todoistTaskId,
    })
    postSwMessage('TIMER_STARTED')
  }

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
        todoistTaskId,
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
      todoistTaskId,
    }
  }, [category, intention, sessionType, startedAt, targetMs, todoistTaskId])

  const finish = useCallback((natural: boolean) => {
    if (finishingRef.current) return
    finishingRef.current = true
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (sessionType === 'break') {
      clearTimerState()
      setPhase('idle')
      setSessionType('focus')
      setTargetMs(settings.focusDuration * 60000)
      setRemainingMs(settings.focusDuration * 60000)
      setStartedAt(0)
      syncToServer({
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
      })
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
    setPhase('reflect')
    clearTimerState()
    syncToServer({
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
    })
    postSwMessage('TIMER_STOPPED')
    if (settings.soundEnabled) {
      try {
        const ctx = new AudioContext()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.setValueAtTime(880, ctx.currentTime)
        gain.gain.setValueAtTime(0.25, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7)
        osc.start()
        osc.stop(ctx.currentTime + 0.7)
      } catch {}
    }
    if (navigator.vibrate) navigator.vibrate([160, 80, 160])
    finishingRef.current = false
  }, [category, makeDraft, postSwMessage, sessionType, settings.focusDuration, settings.soundEnabled, syncToServer])

  useEffect(() => {
    if (phase === 'running' && remainingMs <= 0 && sessionType === 'break') finish(true)
  }, [finish, phase, remainingMs, sessionType])

  const syncTodoistAfterSession = async (taskId: string, actualMs: number) => {
    try {
      const durationRes = await fetch(`/api/todoist/tasks/${taskId}/duration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add_minutes: Math.max(1, Math.round(actualMs / 60000)) }),
      })
      if (!durationRes.ok) {
        setTodoistNotice(await readApiError(durationRes, 'Failed to update Todoist duration'))
        return
      }

      if (!settings.todoistAutoComplete) {
        setTodoistNotice(null)
        return
      }

      const closeRes = await fetch(`/api/todoist/tasks/${taskId}/close`, { method: 'POST' })
      if (!closeRes.ok) {
        setTodoistNotice(await readApiError(closeRes, 'Failed to close Todoist task'))
        return
      }
      setTodoistNotice(null)
    } catch (err) {
      setTodoistNotice(err instanceof Error ? err.message : 'Failed to sync Todoist task')
    }
  }

  const saveReflection = async (rating: number, notes: string) => {
    if (!draft) return
    const session = { ...draft, notes, rating }
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      })
      if (!res.ok) throw new Error('Failed to save session')
      if (draft.todoistTaskId) {
        void syncTodoistAfterSession(draft.todoistTaskId, draft.actualMs)
      }
    } catch {
      const offline: QueuedSession = {
        ...session,
        queuedAt: Date.now(),
      }
      enqueueSession(offline)
    }

    setDraft(null)
    setIntention('')
    setTodoistTaskId(null)
    setStartedAt(0)
    setPhase('idle')
    setSessionType('focus')
    setTargetMs(settings.focusDuration * 60000)
    setRemainingMs(settings.focusDuration * 60000)
  }

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  if (phase === 'running' || phase === 'paused') {
    return (
      <div className="absolute inset-0 z-[150] flex w-full min-w-0 flex-col items-center bg-[var(--bg)] px-7 pb-[calc(40px+var(--safe-b))] pt-[calc(64px+var(--safe-t))] text-[var(--ink)]">
        <div className="min-h-[56px] text-center">
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: isFocus ? selectedCategory?.color ?? 'var(--accent)' : 'var(--ink-3)' }}>
            {isFocus ? selectedCategory?.label ?? 'Focus' : 'Break'}
          </div>
          {intention && isFocus && <div className="mt-[9px] max-w-[300px] text-[18px] font-semibold tracking-[-0.02em]">{intention}</div>}
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-[18px]">
            <div className="relative">
              <Ring progress={progress} size={runningRingSize} stroke={4} track="var(--line)" tint={ringTint} ticks={60} tickColor="var(--ink-2)" dot={false}>
                <div className="h-[44%] w-[44%] rounded-full border border-white/35 bg-[color-mix(in_srgb,var(--bg)_74%,transparent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_14px_36px_rgba(24,18,12,0.08)]" />
              </Ring>
              <div className="pointer-events-none absolute inset-0">
                <div
                  className="absolute left-1/2 top-1/2 rounded-full"
                  style={{
                    width: 4,
                    height: runningRingSize / 2 - 26,
                    background: `linear-gradient(180deg, ${ringTint} 0%, color-mix(in srgb, ${ringTint} 70%, white) 100%)`,
                    transform: `translate(-50%, -100%) rotate(${progress * 360}deg)`,
                    transformOrigin: '50% 100%',
                    boxShadow: `0 6px 18px color-mix(in srgb, ${ringTint} 24%, transparent)`,
                    opacity: 0.96,
                  }}
                >
                  <div
                    className="absolute left-1/2 top-0 rounded-full border border-white/70"
                    style={{
                      width: 18,
                      height: 18,
                      marginLeft: -9,
                      marginTop: -8,
                      background: ringTint,
                      boxShadow: '0 10px 22px rgba(20, 15, 10, 0.18)',
                    }}
                  />
                </div>
                <div
                  className="absolute left-1/2 top-1/2 rounded-full border border-white/60"
                  style={{
                    width: 18,
                    height: 18,
                    marginLeft: -9,
                    marginTop: -9,
                    background: 'var(--surface)',
                    boxShadow: `0 0 0 5px color-mix(in srgb, ${ringTint} 14%, transparent)`,
                  }}
                />
              </div>
            </div>

            <div className="text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">{runningClockLabel}</div>
              <div className="mt-2 font-[var(--font-display)] text-[58px] font-semibold leading-none tracking-[-0.07em] [font-variant-numeric:tabular-nums]">{fmtClock(remainingSec)}</div>
              <div className="mt-2 text-[13px] tracking-[0.01em] text-[var(--ink-3)]">{runningClockDetail}</div>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-[26px]">
          <div className="flex items-center gap-[26px]">
            <button type="button" aria-label="Stop session" onClick={() => finish(false)} className="grid h-[58px] w-[58px] place-items-center rounded-full border-[1.5px] border-[var(--line-strong)] bg-transparent text-[var(--ink)]">
              <Icon name="stop" size={20} />
            </button>
            <button
              type="button"
              aria-label={phase === 'paused' ? 'Resume session' : 'Pause session'}
              onClick={() => phase === 'paused' ? resume() : pause()}
              className="grid h-[86px] w-[86px] place-items-center rounded-full border-0 text-white shadow-[0_10px_30px_rgba(30,22,12,0.18)]"
              style={{ background: isFocus ? selectedCategory?.color ?? 'var(--accent)' : 'var(--ink)', color: isFocus ? '#fff' : 'var(--bg)' }}
            >
              <Icon name={phase === 'paused' ? 'play' : 'pause'} size={32} />
            </button>
            <div className="w-[58px]" />
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'reflect' && draft) {
    return <Reflection draft={draft} category={categoryByName(categories, draft.category)} onSave={saveReflection} onSkip={() => saveReflection(0, '')} />
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden px-[22px] pt-[calc(24px+var(--safe-t))]">
      <div className="flex flex-shrink-0 items-start justify-between">
        <div>
          <div className="text-[13px] text-[var(--ink-3)]">{greeting},</div>
          <div className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.035em]">Ivan</div>
        </div>
        <div className="flex items-center gap-[7px] rounded-[var(--r-pill)] border border-[var(--line)] bg-[var(--surface)] px-[13px] py-2">
          <Icon name="flame" size={17} color="var(--accent)" />
          <span className="text-[15px] font-bold [font-variant-numeric:tabular-nums]">{streak}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden pb-2 pt-3">
        <Seg<SessionType> options={[{ value: 'focus', label: 'Focus' }, { value: 'break', label: 'Break' }]} value={sessionType} onChange={selectSessionType} />
        <div className="flex flex-col items-center gap-[18px]">
          <div className="relative">
            <Ring progress={idleDialProgress} size={idleRingSize} stroke={4} track="var(--line)" tint={isFocus ? selectedCategory?.color ?? 'var(--accent)' : 'var(--line-strong)'} ticks={60} tickColor="var(--ink-3)" animated={!isIdleDialDragging}>
              <div
                data-testid="timer-duration-face-fill"
                className="relative h-[74%] w-[74%] overflow-hidden rounded-full border border-white/45"
                style={{
                  background: `conic-gradient(color-mix(in srgb, ${idleDialTint} 92%, white) 0deg, ${idleDialTint} ${idleDialProgress * 360}deg, color-mix(in srgb, var(--bg) 90%, white) ${idleDialProgress * 360}deg, color-mix(in srgb, var(--bg) 90%, white) 360deg)`,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 0 1px color-mix(in srgb, ${idleDialTint} 14%, transparent), 0 16px 34px rgba(24,18,12,0.08)`,
                }}
              >
                <div
                  className="absolute inset-[14%] rounded-full"
                  style={{
                    background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.58) 18%, color-mix(in srgb, var(--bg) 74%, white) 60%, color-mix(in srgb, var(--bg) 88%, transparent) 100%)',
                  }}
                />
              </div>
            </Ring>
            <div
              data-testid="timer-duration-dial"
              role="slider"
              aria-label={isFocus ? 'Focus length dial' : 'Break length dial'}
              aria-valuemin={durationBounds(sessionType).min}
              aria-valuemax={durationBounds(sessionType).max}
              aria-valuenow={idleDurationMinutes}
              aria-valuetext={`${idleDurationMinutes} minutes`}
              onPointerDown={handleIdleDialPointerDown}
              className="absolute inset-0 touch-none"
              style={{ borderRadius: '50%' }}
            >
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
                style={{
                  width: 4,
                  height: idleRingSize / 2 - 24,
                  background: `linear-gradient(180deg, ${idleDialTint} 0%, color-mix(in srgb, ${idleDialTint} 68%, white) 100%)`,
                  transform: `translate(-50%, -100%) rotate(${idleDialProgress * 360}deg)`,
                  transformOrigin: '50% 100%',
                  opacity: 0.96,
                  transition: isIdleDialDragging ? 'none' : 'transform 180ms ease-out',
                }}
              >
                <div
                  className="absolute left-1/2 top-0 grid rounded-full border border-white/70"
                  style={{
                    width: 24,
                    height: 24,
                    marginLeft: -12,
                    marginTop: -10,
                    placeItems: 'center',
                    background: idleDialTint,
                    color: '#fff',
                    boxShadow: `0 10px 24px color-mix(in srgb, ${idleDialTint} 22%, transparent)`,
                  }}
                >
                  <Icon name="play" size={11} style={{ transform: 'rotate(-90deg)', marginLeft: 1 }} />
                </div>
              </div>
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border border-white/60"
                style={{
                  width: 16,
                  height: 16,
                  marginLeft: -8,
                  marginTop: -8,
                  background: 'var(--surface)',
                  boxShadow: `0 0 0 4px color-mix(in srgb, ${idleDialTint} 16%, transparent)`,
                  }}
              />
            </div>
          </div>

          <div className="text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">{idleClockLabel}</div>
            <div className="mt-2 font-[var(--font-display)] text-[58px] font-semibold leading-none tracking-[-0.07em] [font-variant-numeric:tabular-nums]">{fmtClock(remainingSec)}</div>
          </div>
        </div>

        {isFocus && (
          <div className="flex w-full max-w-[340px] flex-col gap-2.5">
            <div className="hide-scrollbar -mx-1 overflow-x-auto overflow-y-hidden px-1 pb-1">
              <div data-testid="timer-category-selector" className="flex min-w-max flex-nowrap gap-2">
                {sortedCategories.map(cat => (
                  <Chip key={cat.id} color={cat.color} active={category === cat.name} onClick={() => {
                    setCategory(cat.name)
                    setRecentCategories(markCategoryUsed(cat.name))
                    syncToServer({
                      phase: 'idle',
                      sessionType,
                      intention,
                      category: cat.name,
                      targetMs,
                      remainingMs,
                      overflowMs: 0,
                      startedAt: null,
                      pausedAt: null,
                      todoistTaskId,
                    })
                  }}>{cat.label}</Chip>
                ))}
              </div>
            </div>
            {compactCategoryLayout && (
              <div className="px-1 text-center text-[12px] text-[var(--ink-3)]">Swipe to see all categories</div>
            )}
            <button
              type="button"
              onClick={() => setSheet('intention')}
              className="flex w-full items-center gap-3 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-4 py-[14px] text-left"
            >
              <Icon name={todoistTaskId ? 'link' : 'edit'} size={18} color="var(--ink-3)" />
              <span className="min-w-0 flex-1 truncate text-[15.5px] font-semibold tracking-[-0.01em]" style={{ color: intention ? 'var(--ink)' : 'var(--ink-3)' }}>
                {intention || 'Add an intention (optional)'}
              </span>
            </button>
            {todoistOpenCount > 0 && (
              <button type="button" onClick={() => setSheet('tasks')} className="flex items-center justify-center gap-[7px] border-0 bg-transparent p-0 text-[13.5px] font-medium text-[var(--ink-3)]">
                <Icon name="list" size={15} color="#E44332" />
                Choose from Todoist
              </button>
            )}
            {todoistNotice && (
              <div className="rounded-[var(--r-md)] border border-[#C2615A]/20 bg-[#C2615A]/10 px-4 py-3 text-center text-[13px] leading-normal text-[#C2615A]">
                {todoistNotice}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 pb-[var(--screen-bottom-space)] pt-2">
        <Btn full size="lg" variant="accent" icon="play" onClick={() => start()} style={isFocus ? { background: selectedCategory?.color ?? 'var(--accent)' } : undefined}>
          {isFocus ? 'Start focus' : 'Start break'}
        </Btn>
      </div>

      <IntentionSheet
        open={sheet === 'intention'}
        intention={intention}
        onClose={() => setSheet(null)}
        onSave={(value) => {
          setIntention(value)
          setTodoistTaskId(null)
          setSheet(null)
        }}
      />
      <TaskPickerSheet
        open={sheet === 'tasks'}
        onClose={() => setSheet(null)}
        categories={categories}
        fallbackCategory={category}
        activeId={todoistTaskId}
        onPick={(task, categoryName) => {
          setIntention(task.content)
          setCategory(categoryName)
          setTodoistTaskId(task.id)
          setSheet(null)
        }}
      />
    </div>
  )
}
