'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, SkipForward, Square } from 'lucide-react'
import { Button, Segmented, SegmentedButton } from 'konsta/react'
import ProgressRing from './ProgressRing'
import TodoistTasks from './TodoistTasks'
import { useSettings } from '@/context/SettingsContext'
import { useCategories } from '@/context/CategoriesContext'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { saveTimerState, loadTimerState, clearTimerState, enqueueSession, type QueuedSession } from '@/lib/local-store'
import type { Category, SessionType, TimerPhase, TodoistTask } from '@/types'

function interpolateColor(hex1: string, hex2: string, t: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const parse = (hex: string) => {
    const h = hex.replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const [r1, g1, b1] = parse(hex1)
  const [r2, g2, b2] = parse(hex2)
  const r = clamp(r1 + (r2 - r1) * t)
  const g = clamp(g1 + (g2 - g1) * t)
  const b = clamp(b1 + (b2 - b1) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function formatTime(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : 0
  const totalSec = Math.floor(Math.abs(safe) / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Coerce a value to epoch-ms number, handling ISO strings from legacy clients */
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

/** Ensure all numeric timer fields are valid numbers */
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

export default function Timer() {
  const { settings } = useSettings()
  const { categories, byName } = useCategories()
  const online = useOnlineStatus()
  const [phase, setPhase] = useState<TimerPhase>('idle')
  const [sessionType, setSessionType] = useState<SessionType>('focus')
  const [intention, setIntention] = useState('')
  const [category, setCategory] = useState<Category>('')
  const [remainingMs, setRemainingMs] = useState(settings.focusDuration * 60 * 1000)
  const [overflowMs, setOverflowMs] = useState(0)
  const [startedAt, setStartedAt] = useState<number>(0)
  const [synced, setSynced] = useState<boolean | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [todoistTaskId, setTodoistTaskId] = useState<string | null>(null)
  const [todoistTaskContent, setTodoistTaskContent] = useState<string>('')
  const [customDurationMs, setCustomDurationMs] = useState(settings.focusDuration * 60 * 1000)
  const [activeTargetMs, setActiveTargetMs] = useState(settings.focusDuration * 60 * 1000)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPutRef = useRef<number>(0)
  const phaseRef = useRef<TimerPhase>('idle')
  const startedAtRef = useRef<number>(0)
  const remainingMsRef = useRef(remainingMs)
  const overflowMsRef = useRef(overflowMs)
  const sessionTypeRef = useRef(sessionType)
  const intentionRef = useRef(intention)
  const categoryRef = useRef(category)
  const serverUpdatedAtRef = useRef(0)
  const intentionSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { startedAtRef.current = startedAt }, [startedAt])
  useEffect(() => { remainingMsRef.current = remainingMs }, [remainingMs])
  useEffect(() => { overflowMsRef.current = overflowMs }, [overflowMs])
  useEffect(() => { sessionTypeRef.current = sessionType }, [sessionType])
  useEffect(() => { intentionRef.current = intention }, [intention])
  useEffect(() => { categoryRef.current = category }, [category])

  // ── Persist timer state to localStorage for offline resilience ──
  useEffect(() => {
    if (phase === 'idle') {
      // Save idle config so it restores on reload
      saveTimerState({
        phase, sessionType, intention, category,
        targetMs: customDurationMs, remainingMs: customDurationMs,
        overflowMs: 0, startedAt: null, pausedAt: null,
        todoistTaskId, savedAt: Date.now(),
      })
    } else {
      saveTimerState({
        phase, sessionType, intention, category,
        targetMs: activeTargetMs, remainingMs,
        overflowMs, startedAt: startedAt || null,
        pausedAt: phase === 'paused' ? Date.now() : null,
        todoistTaskId, savedAt: Date.now(),
      })
    }
  }, [phase, sessionType, intention, category, customDurationMs, activeTargetMs, remainingMs, overflowMs, startedAt, todoistTaskId])

  // Once categories are loaded, ensure the selected category actually exists.
  // If it doesn't (e.g. initial empty string, or a renamed/deleted slug), fall
  // back to the default category (is_default) or the first available one.
  useEffect(() => {
    if (categories.length === 0) return // still loading
    if (category && byName[category]) return // already valid
    const defaultCat = categories.find(c => c.isDefault) ?? categories[0]
    if (defaultCat) setCategory(defaultCat.name)
  }, [categories, byName, category])

  const todoistTaskIdRef = useRef<string | null>(null)
  useEffect(() => { todoistTaskIdRef.current = todoistTaskId }, [todoistTaskId])

  const customDurationMsRef = useRef(customDurationMs)
  useEffect(() => { customDurationMsRef.current = customDurationMs }, [customDurationMs])
  const activeTargetMsRef = useRef(activeTargetMs)
  useEffect(() => { activeTargetMsRef.current = activeTargetMs }, [activeTargetMs])
  const suppressIdleResetRef = useRef(false)

  const defaultDurationMs = sessionType === 'focus'
    ? settings.focusDuration * 60 * 1000
    : sessionType === 'short-break'
    ? settings.shortBreakDuration * 60 * 1000
    : settings.longBreakDuration * 60 * 1000

  const targetMs = phase === 'idle' ? customDurationMs : activeTargetMs

  useEffect(() => {
    if (phase === 'idle') {
      if (suppressIdleResetRef.current) {
        suppressIdleResetRef.current = false
        return
      }
      setCustomDurationMs(defaultDurationMs)
      setRemainingMs(defaultDurationMs)
      setActiveTargetMs(defaultDurationMs)
    }
  }, [defaultDurationMs, sessionType, phase])

  const postSwMessage = useCallback(async (type: 'TIMER_STARTED' | 'TIMER_STOPPED') => {
    if (!('serviceWorker' in navigator)) return
    try {
      const reg = await navigator.serviceWorker.ready
      reg.active?.postMessage({ type })
    } catch {}
  }, [])

  const playChime = useCallback(() => {
    if (!settings.soundEnabled) return
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.3)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
      osc.start()
      osc.stop(ctx.currentTime + 0.8)
    } catch {}
  }, [settings.soundEnabled])

  const buildTimerPayload = useCallback((overrides?: Partial<{
    phase: TimerPhase
    sessionType: SessionType
    intention: string
    category: Category
    remainingMs: number
    overflowMs: number
    startedAt: number | null
    pausedAt: number | null
  }>) => ({
    phase: overrides?.phase ?? phaseRef.current,
    sessionType: overrides?.sessionType ?? sessionTypeRef.current,
    intention: overrides?.intention ?? intentionRef.current,
    category: overrides?.category ?? categoryRef.current,
    targetMs,
    remainingMs: overrides?.remainingMs ?? remainingMsRef.current,
    overflowMs: overrides?.overflowMs ?? overflowMsRef.current,
    startedAt: overrides?.startedAt !== undefined ? overrides.startedAt : startedAtRef.current,
    pausedAt: overrides?.pausedAt !== undefined ? overrides.pausedAt : (phaseRef.current === 'paused' ? Date.now() : null),
    todoistTaskId: todoistTaskIdRef.current,
  }), [targetMs])

  const tick = useCallback(() => {
    setRemainingMs(prev => {
      if (prev <= 0) {
        setOverflowMs(o => o + 100)
        setPhase('overflow')
        return prev - 100
      }
      return prev - 100
    })
  }, [])

  const syncToServer = useCallback(async (body: Record<string, unknown>) => {
    if (!navigator.onLine) { setSynced(false); return }
    lastPutRef.current = Date.now()
    try {
      const res = await fetch('/api/timer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { setSynced(false); return }
      const data: ServerTimerState = await res.json()
      serverUpdatedAtRef.current = data.updatedAt
      setSynced(true)
    } catch { setSynced(false) }
  }, [])

  const applyServerState = useCallback((rawData: ServerTimerState) => {
    const data = normalizeTimerState(rawData)
    if (data.phase === 'running' && data.startedAt) {
      // Use remainingMs at updatedAt as the authoritative countdown state.
      // This is consistent with Raycast's timer-state.ts and handles
      // pause/resume correctly (startedAt doesn't account for paused time).
      const elapsedSinceUpdate = Date.now() - data.updatedAt
      const newRemaining = data.remainingMs - elapsedSinceUpdate
      if (intervalRef.current) clearInterval(intervalRef.current)
      setPhase(newRemaining > 0 ? 'running' : 'overflow')
      setSessionType(data.sessionType as SessionType)
      setIntention(data.intention)
      setCategory(data.category as Category)
      setRemainingMs(newRemaining)
      setOverflowMs(newRemaining > 0 ? data.overflowMs : Math.abs(newRemaining))
      setStartedAt(data.startedAt)
      setActiveTargetMs(data.targetMs)
      setTodoistTaskId(data.todoistTaskId ?? null)
      if (!data.todoistTaskId) setTodoistTaskContent('')
      intervalRef.current = setInterval(tick, 100)
    } else if (data.phase === 'paused') {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      setPhase('paused')
      setSessionType(data.sessionType as SessionType)
      setIntention(data.intention)
      setCategory(data.category as Category)
      setRemainingMs(data.remainingMs)
      setOverflowMs(data.overflowMs)
      setActiveTargetMs(data.targetMs)
      if (data.startedAt) setStartedAt(data.startedAt)
      setTodoistTaskId(data.todoistTaskId ?? null)
      if (!data.todoistTaskId) setTodoistTaskContent('')
    }
  }, [tick])

  // On mount: fetch server state, fall back to localStorage when offline
  useEffect(() => {
    const restoreFromLocal = () => {
      const local = loadTimerState()
      if (!local) return
      suppressIdleResetRef.current = true
      if (local.sessionType) setSessionType(local.sessionType as SessionType)
      if (local.category) setCategory(local.category as Category)
      if (local.intention) setIntention(local.intention)
      setTodoistTaskId(local.todoistTaskId ?? null)

      if ((local.phase === 'running' || local.phase === 'overflow') && local.startedAt) {
        // Recompute remaining from savedAt + remainingMs (handles pause/resume correctly)
        const elapsedSinceSave = Date.now() - local.savedAt
        const newRemaining = local.remainingMs - elapsedSinceSave
        setActiveTargetMs(local.targetMs)
        setStartedAt(local.startedAt)
        setRemainingMs(newRemaining)
        setOverflowMs(newRemaining > 0 ? 0 : Math.abs(newRemaining))
        setPhase(newRemaining > 0 ? 'running' : 'overflow')
        intervalRef.current = setInterval(tick, 100)
        postSwMessage('TIMER_STARTED')
      } else if (local.phase === 'paused') {
        setActiveTargetMs(local.targetMs)
        if (local.startedAt) setStartedAt(local.startedAt)
        setRemainingMs(local.remainingMs)
        setOverflowMs(local.overflowMs)
        setPhase('paused')
      } else {
        // idle
        if (local.remainingMs) {
          setCustomDurationMs(local.remainingMs)
          setActiveTargetMs(local.remainingMs)
          setRemainingMs(local.remainingMs)
        }
        postSwMessage('TIMER_STOPPED')
      }
    }

    const init = async () => {
      try {
        const res = await fetch('/api/timer')
        if (!res.ok) { setSynced(false); restoreFromLocal(); return }
        const data: ServerTimerState = normalizeTimerState(await res.json())
        setSynced(true)
        serverUpdatedAtRef.current = data.updatedAt
        if (data.phase === 'running' || data.phase === 'paused') {
          applyServerState(data)
          postSwMessage('TIMER_STARTED')
        } else {
          if (data.phase === 'idle') {
            suppressIdleResetRef.current = true
            if (data.sessionType) setSessionType(data.sessionType as SessionType)
            if (data.category) setCategory(data.category as Category)
            if (data.intention) setIntention(data.intention)
            if (data.remainingMs) {
              setCustomDurationMs(data.remainingMs)
              setActiveTargetMs(data.remainingMs)
              setRemainingMs(data.remainingMs)
            }
          }
          postSwMessage('TIMER_STOPPED')
        }
      } catch {
        setSynced(false)
        restoreFromLocal()
      }
    }
    init()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (intentionSyncTimeoutRef.current) clearTimeout(intentionSyncTimeoutRef.current)
    }
  }, [applyServerState, postSwMessage])

  // Poll every 2s
  useEffect(() => {
    const poll = setInterval(async () => {
      if (Date.now() - lastPutRef.current < 3000) return
      try {
        const res = await fetch('/api/timer')
        if (!res.ok) { setSynced(false); return }
        const data: ServerTimerState = normalizeTimerState(await res.json())
        setSynced(true)
        if (data.updatedAt <= serverUpdatedAtRef.current) return
        serverUpdatedAtRef.current = data.updatedAt

        if (data.phase === 'running' || data.phase === 'paused') {
          applyServerState(data)
        } else if (data.phase === 'idle' && phaseRef.current !== 'idle') {
          if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
          const idleDuration = data.remainingMs || data.targetMs
          suppressIdleResetRef.current = true
          setPhase('idle')
          setSessionType(data.sessionType as SessionType)
          setCategory(data.category as Category)
          setCustomDurationMs(idleDuration)
          setActiveTargetMs(idleDuration)
          setRemainingMs(idleDuration)
          setOverflowMs(0)
          setStartedAt(0)
          setIntention(data.intention)
          setTodoistTaskId(null)
          setTodoistTaskContent('')
          postSwMessage('TIMER_STOPPED')
        } else if (data.phase === 'idle' && phaseRef.current === 'idle') {
          const idleDuration = data.remainingMs || data.targetMs
          suppressIdleResetRef.current = true
          setSessionType(data.sessionType as SessionType)
          setCategory(data.category as Category)
          setCustomDurationMs(idleDuration)
          setActiveTargetMs(idleDuration)
          setRemainingMs(idleDuration)
          setIntention(data.intention)
        }
      } catch { setSynced(false) }
    }, 2000)
    return () => clearInterval(poll)
  }, [applyServerState, postSwMessage])

  // Re-sync on visibility change
  useEffect(() => {
    let lastResync = 0
    const resync = async () => {
      const now = Date.now()
      if (now - lastResync < 500) return
      lastResync = now
      try {
        const res = await fetch('/api/timer', { cache: 'no-store' })
        if (!res.ok) return
        const data: ServerTimerState = normalizeTimerState(await res.json())
        setSynced(true)
        serverUpdatedAtRef.current = data.updatedAt
        if (data.phase === 'running' || data.phase === 'paused') {
          applyServerState(data)
        } else if (data.phase === 'idle') {
          if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
          const idleDuration = data.remainingMs || data.targetMs || targetMs
          suppressIdleResetRef.current = true
          setPhase('idle')
          setSessionType(data.sessionType as SessionType)
          setCategory(data.category as Category)
          setCustomDurationMs(idleDuration)
          setActiveTargetMs(idleDuration)
          setRemainingMs(idleDuration)
          setOverflowMs(0)
          setStartedAt(0)
          setIntention(data.intention)
        }
      } catch {}
    }
    const onVisible = () => { if (!document.hidden) resync() }
    const onFocus = () => resync()
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) resync() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [applyServerState, targetMs])

  const handleIntentionChange = useCallback((value: string) => {
    setIntention(value)
    if (phaseRef.current === 'idle') return
    if (intentionSyncTimeoutRef.current) clearTimeout(intentionSyncTimeoutRef.current)
    intentionSyncTimeoutRef.current = setTimeout(() => {
      syncToServer(buildTimerPayload({
        intention: value,
        pausedAt: phaseRef.current === 'paused' ? Date.now() : null,
      }))
    }, 500)
  }, [buildTimerPayload, syncToServer])

  const startTimer = useCallback(() => {
    const isIdle = phaseRef.current === 'idle'
    const now = Date.now()
    const newStartedAt = isIdle ? now : startedAtRef.current
    const nextTargetMs = isIdle ? customDurationMsRef.current : activeTargetMsRef.current

    if (isIdle) {
      setStartedAt(now)
      setOverflowMs(0)
      setActiveTargetMs(nextTargetMs)
      setRemainingMs(nextTargetMs)
    }
    setPhase('running')
    intervalRef.current = setInterval(tick, 100)

    syncToServer({
      phase: 'running',
      sessionType,
      intention,
      category,
      targetMs: nextTargetMs,
      remainingMs: isIdle ? nextTargetMs : remainingMs,
      overflowMs: isIdle ? 0 : overflowMs,
      startedAt: newStartedAt,
      pausedAt: null,
      todoistTaskId: todoistTaskIdRef.current,
    })
    postSwMessage('TIMER_STARTED')
  }, [tick, syncToServer, postSwMessage, sessionType, intention, category, remainingMs, overflowMs])

  const pauseTimer = useCallback(() => {
    setPhase('paused')
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    syncToServer({
      phase: 'paused', sessionType, intention, category, targetMs,
      remainingMs, overflowMs, startedAt, pausedAt: Date.now(),
      todoistTaskId: todoistTaskIdRef.current,
    })
    postSwMessage('TIMER_STOPPED')
  }, [syncToServer, postSwMessage, sessionType, intention, category, targetMs, remainingMs, overflowMs, startedAt])

  const finishSession = useCallback(async () => {
    if (intentionSyncTimeoutRef.current) { clearTimeout(intentionSyncTimeoutRef.current); intentionSyncTimeoutRef.current = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }

    const now = Date.now()
    const actualMs = startedAt ? now - startedAt : 0
    const curOverflowMs = Math.max(0, overflowMs)

    // Build the session record for offline queueing
    const effectiveStartedAt = startedAt || now
    const offlineSession: QueuedSession = {
      id: `offline-${effectiveStartedAt}`,
      intention,
      category,
      type: sessionType,
      targetMs: activeTargetMs,
      actualMs,
      overflowMs: curOverflowMs,
      startedAt: effectiveStartedAt,
      endedAt: now,
      notes: '',
      todoistTaskId: todoistTaskIdRef.current,
      queuedAt: now,
    }

    try {
      const res = await fetch('/api/timer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startedAt, intention, category, notes: '' }),
      })
      if (!res.ok) throw new Error('Failed to save session')
      const data = await res.json()
      setSaveError(null)

      if (data.completed && settings.calendarSync && data.session) {
        fetch('/api/calendar/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intention: data.session.intention,
            category: data.session.category,
            type: data.session.type,
            startedAt: data.session.startedAt,
            endedAt: data.session.endedAt,
            targetMs: data.session.targetMs,
            actualMs: data.session.actualMs,
            overflowMs: data.session.overflowMs,
          }),
        }).catch(() => {})
      }

      if (data.timer?.updatedAt) serverUpdatedAtRef.current = data.timer.updatedAt
    } catch {
      // Offline: queue the session for later sync
      enqueueSession(offlineSession)
      setSaveError(null) // Don't show error — queued for later
    }

    if (settings.soundEnabled) playChime()

    if (Notification.permission === 'granted') {
      let pushActive = false
      try {
        const flagSet = localStorage.getItem('pushSubscriptionConfirmed') === '1'
        if (flagSet && 'serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready
          const sub = await reg.pushManager.getSubscription()
          if (sub) { pushActive = true } else { localStorage.removeItem('pushSubscriptionConfirmed') }
        }
      } catch { try { localStorage.removeItem('pushSubscriptionConfirmed') } catch {} }
      if (!pushActive) {
        new Notification('sesh — session complete', {
          body: intention || `${sessionType} finished`,
          icon: '/icons/icon-192.png',
        })
      }
    }

    if (navigator.vibrate) navigator.vibrate([200, 100, 200])
    postSwMessage('TIMER_STOPPED')

    setPhase('idle')
    setCustomDurationMs(defaultDurationMs)
    setRemainingMs(defaultDurationMs)
    setOverflowMs(0)
    setIntention('')
    setTodoistTaskId(null)
    setTodoistTaskContent('')
    clearTimerState()
  }, [startedAt, intention, category, sessionType, activeTargetMs, overflowMs, defaultDurationMs, settings.soundEnabled, settings.calendarSync, playChime, postSwMessage, tick])

  const abandonSession = useCallback(() => {
    if (intentionSyncTimeoutRef.current) { clearTimeout(intentionSyncTimeoutRef.current); intentionSyncTimeoutRef.current = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    setPhase('idle')
    setCustomDurationMs(defaultDurationMs)
    setRemainingMs(defaultDurationMs)
    setOverflowMs(0)
    setIntention('')
    setTodoistTaskId(null)
    setTodoistTaskContent('')
    syncToServer({
      phase: 'idle', sessionType, intention: '', category,
      targetMs: defaultDurationMs, remainingMs: defaultDurationMs,
      overflowMs: 0, startedAt: null, pausedAt: null, todoistTaskId: null,
    })
    postSwMessage('TIMER_STOPPED')
  }, [defaultDurationMs, syncToServer, postSwMessage, sessionType, category])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'running') pauseTimer()
        else if (phase === 'paused' || phase === 'overflow') startTimer()
      }
      if (e.code === 'Enter' && phase === 'idle') startTimer()
      if (e.code === 'Escape' && (phase === 'running' || phase === 'paused' || phase === 'overflow')) abandonSession()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, startTimer, pauseTimer, abandonSession])

  const handleTodoistTaskSelect = useCallback((task: TodoistTask | null) => {
    setTodoistTaskId(task?.id ?? null)
    setTodoistTaskContent(task?.content ?? '')
  }, [])

  const isOverflow = remainingMs < 0

  const displayMs = phase === 'idle'
    ? customDurationMs
    : isOverflow ? Math.abs(remainingMs) : remainingMs

  const progress = phase === 'idle'
    ? customDurationMs / (60 * 60 * 1000)
    : isOverflow ? 1 : Math.max(0, remainingMs / activeTargetMs)

  const getRingColor = () => {
    // Break sessions always green
    if (sessionType !== 'focus') {
      if (isOverflow) return '#FF9500'
      return '#34C759'
    }
    // Focus: category color, shifting to warning as time runs low
    if (isOverflow) return '#FF9500'
    const categoryColor = byName[category]?.color ?? '#6b7280'
    if (phase === 'idle') return categoryColor
    const timeRatio = remainingMs / activeTargetMs  // 1.0 = full, 0.0 = done
    if (timeRatio > 0.2) return categoryColor
    // Blend from category color to warning orange in last 20%
    const urgencyRatio = timeRatio / 0.2  // 1.0 at 20%, 0.0 at 0%
    return interpolateColor(categoryColor, '#FF9500', 1 - urgencyRatio)
  }
  const ringColor = getRingColor()

  const viewState = phase === 'idle' ? 'idle' : 'active'

  // Determine the display intention for the active state

  // Whether to show the text input in idle (only when no Todoist task selected)
  const showIdleIntentionInput = !todoistTaskId

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      padding: '16px 16px calc(24px + env(safe-area-inset-bottom, 0px))',
      paddingTop: '16px',
      minHeight: 'calc(100dvh - 83px - env(safe-area-inset-bottom, 0px))',
      
      overscrollBehavior: 'contain' as const,
      boxSizing: 'border-box' as const,
      marginTop: 8,
                width: '100%',
      position: 'relative',
    }}>
      {/* Sync indicator: green=online+synced, orange=offline, grey=unknown */}
      <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: !online ? '#FF9500' : synced === null ? 'var(--text-tertiary)' : synced ? 'var(--success)' : '#FF9500',
          transition: 'background 0.3s ease',
        }} />
      </div>

      {viewState === 'idle' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            marginTop: 8,
                width: '100%',
            
            paddingTop: 0,
          }}
        >
          {/* ═══ TOP SECTION: Todoist + Intention + Category + Session Type ═══ */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
            {/* Todoist tasks — compact at top */}
            <div style={{ width: '100%', maxWidth: 361 }}>
              <TodoistTasks
                selectedTaskId={todoistTaskId}
                onSelectTask={handleTodoistTaskSelect}
              />
            </div>

            {/* Intention input — only when no Todoist task selected */}
            {showIdleIntentionInput ? (
              <div style={{ width: '100%', maxWidth: 361 }}>
                <input
                  type="text"
                  value={intention}
                  onChange={e => handleIntentionChange(e.target.value)}
                  placeholder="What are you working on?"
                  maxLength={120}
                  style={{
                    marginTop: 8,
                width: '100%',
                    padding: '8px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: 15,
                    outline: 'none',
                    transition: 'border-color 0.2s ease',
                    minHeight: 38,
                  }}
                  onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
                />
              </div>
            ) : null}

            {/* Category pills + Session type pills — two-row layout */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 360 }}>
              <div
                className="hide-scrollbar"
                style={{
                  display: 'flex',
                  gap: 6,
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  marginTop: 8,
                width: '100%',
                  overflowX: 'auto',
                  flexWrap: 'nowrap',
                }}
              >
                <div style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  flexWrap: 'nowrap',
                  margin: '0 auto',
                  flex: '0 0 auto',
                }}>
                  {categories.map(cat => (
                    <button
                      key={cat.name}
                      onClick={() => {
                        setCategory(cat.name)
                        syncToServer({
                          phase: 'idle', sessionType, intention, category: cat.name,
                          targetMs: customDurationMs, remainingMs: customDurationMs,
                          overflowMs: 0, startedAt: null, pausedAt: null,
                        })
                      }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '5px 12px', borderRadius: 8, border: 'none',
                        fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        background: category === cat.name ? `${cat.color}40` : 'var(--bg-secondary)',
                        color: category === cat.name ? cat.color : 'var(--text-secondary)',
                        transition: 'all 0.15s ease',
                        flex: '0 0 auto',
                      }}
                    >
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: cat.color,
                        display: 'inline-block',
                      }} />
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <Segmented strong rounded>
                {(['focus', 'short-break', 'long-break'] as SessionType[]).map(t => (
                  <SegmentedButton
                    key={t}
                    strong
                    rounded
                    active={sessionType === t}
                    onClick={() => setSessionType(t)}
                  >
                    {t === 'focus' ? 'Focus' : t === 'short-break' ? 'Short' : 'Long'}
                  </SegmentedButton>
                ))}
              </Segmented>
            </div>
          </div>

          {/* ═══ MIDDLE SECTION: Ring + Time display ═══ */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            {/* THE HERO — Timer Ring (large, empty center) */}
            <ProgressRing
              progress={progress}
              color={ringColor}
              size={140}
              strokeWidth={8}
              interactive={true}
              onProgressChange={(p) => {
                const minutes = Math.max(1, Math.min(60, Math.round(p * 60)))
                const ms = minutes * 60 * 1000
                setCustomDurationMs(ms)
                setRemainingMs(ms)
              }}
              onDragEnd={(p) => {
                const minutes = Math.max(1, Math.min(60, Math.round(p * 60)))
                const ms = minutes * 60 * 1000
                syncToServer({
                  phase: 'idle', sessionType: sessionTypeRef.current,
                  intention: intentionRef.current, category: categoryRef.current,
                  targetMs: ms, remainingMs: ms, overflowMs: 0,
                  startedAt: null, pausedAt: null,
                })
              }}
            >
              <></>
            </ProgressRing>

            {/* Time display BELOW ring */}
            <span className="font-mono" style={{ fontSize: 36, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1 }}>
              {formatTime(displayMs)}
            </span>

            {/* Time range label */}
            <span style={{
              fontSize: 14,
              color: 'var(--text-primary)',
              background: 'var(--bg-secondary)',
              padding: '4px 14px',
              borderRadius: 20,
              lineHeight: 1.4,
            }}>
              {(() => {
                const now = new Date()
                const end = new Date(now.getTime() + (customDurationMs || remainingMs))
                const fmt = (d: Date) => d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
                return `${fmt(now)} → ${fmt(end)}`
              })()}
            </span>
          </div>

          {/* ═══ BOTTOM SECTION: Start button ═══ */}
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', paddingBottom: 4 }}>
            <Button
              large
              rounded
              onClick={startTimer}
              className="!w-full !max-w-[320px] !mt-2 !min-h-[52px] !text-[15px] !font-semibold !tracking-wider !uppercase"
            >
              START SESSION
            </Button>
          </div>
        </div>
      ) : (
        /* ═══════ ACTIVE STATE ═══════ */
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            marginTop: 8,
                width: '100%',
          }}
        >
          {/* Intention + phase header + category badge */}
          <div style={{ textAlign: 'center', maxWidth: 320, width: '100%' }}>
            <input
              type="text"
              value={intention || todoistTaskContent}
              onChange={e => {
                handleIntentionChange(e.target.value)
                syncToServer(buildTimerPayload({
                  intention: e.target.value,
                  pausedAt: phase === 'paused' ? Date.now() : null,
                }))
              }}
              placeholder="Tap to add intention..."
              maxLength={120}
              style={{
                marginTop: 8,
                width: '100%',
                fontSize: 20,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 4,
                lineHeight: 1.3,
                textAlign: 'center',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid transparent',
                outline: 'none',
                padding: '4px 0',
                transition: 'border-color 0.2s ease',
              }}
              onFocus={e => { e.target.style.borderBottomColor = 'var(--accent)' }}
              onBlur={e => { e.target.style.borderBottomColor = 'transparent' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <p style={{
                fontSize: 11, fontWeight: 600, letterSpacing: '1.4px', textTransform: 'uppercase',
                color: isOverflow ? 'var(--warning)' : 'var(--text-secondary)',
                margin: 0,
              }}>
                {isOverflow ? 'OVERFLOW' : phase === 'paused' ? 'PAUSED' : sessionType === 'focus' ? 'FOCUS' : 'BREAK'}
              </p>
              <button
                onClick={() => {
                  const names = categories.map(c => c.name)
                  const idx = names.indexOf(category)
                  const next = names[(idx + 1) % names.length] || category
                  setCategory(next)
                  syncToServer(buildTimerPayload({
                    category: next,
                    pausedAt: phase === 'paused' ? Date.now() : null,
                  }))
                }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 10,
                  border: 'none', cursor: 'pointer',
                  background: `${(byName[category]?.color ?? '#6b7280')}22`,
                  color: byName[category]?.color ?? '#6b7280',
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.5px',
                  textTransform: 'uppercase', lineHeight: 1,
                  minHeight: 20,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: byName[category]?.color ?? '#6b7280',
                  display: 'inline-block',
                }} />
                {byName[category]?.label ?? category}
              </button>
            </div>
          </div>

          {/* Ring — THE HERO */}
          <ProgressRing
            progress={progress}
            color={ringColor}
            size={280}
            strokeWidth={8}
            interactive={false}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {isOverflow && (
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--warning)', marginBottom: 4 }}>+{formatTime(overflowMs)}</span>
              )}
              <span className="font-mono" style={{ fontSize: 52, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                {formatTime(displayMs)}
              </span>
            </div>
          </ProgressRing>

          {/* Controls — Konsta buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {(phase === 'running' || phase === 'overflow') && (
              <>
                <Button clear rounded onClick={pauseTimer} className="!min-h-[44px]">
                  <Pause style={{ width: 18, height: 18, marginRight: 6 }} />
                  Pause
                </Button>
                <Button clear rounded onClick={finishSession} className="!min-h-[44px]">
                  <SkipForward style={{ width: 18, height: 18, marginRight: 6 }} />
                  Finish
                </Button>
              </>
            )}
            {phase === 'paused' && (
              <>
                <Button rounded onClick={startTimer} className="!min-h-[44px]">
                  <Play style={{ width: 16, height: 16, fill: '#fff', marginRight: 6 }} />
                  Resume
                </Button>
                <Button clear rounded onClick={finishSession} className="!min-h-[44px]">
                  <SkipForward style={{ width: 18, height: 18, marginRight: 6 }} />
                  Finish
                </Button>
              </>
            )}
          </div>

          {/* Abandon — minimal */}
          <Button clear small onClick={abandonSession} className="!min-h-[44px] !text-gray-400 hover:!text-red-500">
            <Square style={{ width: 14, height: 14, marginRight: 6 }} />
            Abandon
          </Button>

          {/* Save error */}
          {saveError && (
            <div style={{
              padding: '10px 16px', borderRadius: 12,
              background: 'rgba(255, 59, 48, 0.08)', color: 'var(--danger)', fontSize: 14,
            }}>
              {saveError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
