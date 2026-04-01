'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, SkipForward, Square } from 'lucide-react'
import {
  Button,
  Segmented,
  SegmentedButton,
  Chip,
} from 'konsta/react'
import ProgressRing from './ProgressRing'
import TodoistTasks from './TodoistTasks'
import { useSettings } from '@/context/SettingsContext'
import { useCategories } from '@/context/CategoriesContext'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { saveTimerState, loadTimerState, clearTimerState, enqueueSession, type QueuedSession } from '@/lib/local-store'
import { getCategoryMeta } from '@/lib/categories'
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

  // Ensure selected category is valid
  useEffect(() => {
    if (categories.length === 0) return
    if (category && byName[category]) return
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
    : settings.breakDuration * 60 * 1000

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      enqueueSession(offlineSession)
      setSaveError(null)
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

    // Auto-cycle: pre-select the next type but stay in idle
    const nextType: SessionType = sessionType === 'focus' ? 'break' : 'focus'
    const nextDurationMs = nextType === 'focus'
      ? settings.focusDuration * 60 * 1000
      : settings.breakDuration * 60 * 1000

    setPhase('idle')
    setSessionType(nextType)
    setCustomDurationMs(nextDurationMs)
    setRemainingMs(nextDurationMs)
    setOverflowMs(0)
    setTodoistTaskId(null)
    clearTimerState()
    postSwMessage('TIMER_STOPPED')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, intention, category, sessionType, activeTargetMs, overflowMs, defaultDurationMs, settings.soundEnabled, settings.calendarSync, settings.focusDuration, settings.breakDuration, playChime, postSwMessage, tick, syncToServer])

  const abandonSession = useCallback(() => {
    if (intentionSyncTimeoutRef.current) { clearTimeout(intentionSyncTimeoutRef.current); intentionSyncTimeoutRef.current = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    setPhase('idle')
    setCustomDurationMs(defaultDurationMs)
    setRemainingMs(defaultDurationMs)
    setOverflowMs(0)
    setIntention('')
    setTodoistTaskId(null)
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
    if (task?.content) {
      setIntention(task.content)
    }
  }, [])

  // ── Derived display values ──
  const isOverflow = remainingMs < 0

  const displayMs = phase === 'idle'
    ? customDurationMs
    : isOverflow ? Math.abs(remainingMs) : remainingMs

  const progress = phase === 'idle'
    ? customDurationMs / (60 * 60 * 1000)
    : isOverflow ? 1 : Math.max(0, remainingMs / activeTargetMs)

  const getRingColor = () => {
    if (sessionType !== 'focus') {
      if (isOverflow) return '#FF9500'
      return '#34C759'
    }
    if (isOverflow) return '#FF9500'
    const meta = getCategoryMeta(category, categories)
    const categoryColor = meta.color
    if (phase === 'idle') return categoryColor
    const timeRatio = remainingMs / activeTargetMs
    if (timeRatio > 0.2) return categoryColor
    const urgencyRatio = timeRatio / 0.2
    return interpolateColor(categoryColor, '#FF9500', 1 - urgencyRatio)
  }
  const ringColor = getRingColor()

  const showIdleIntentionInput = !todoistTaskId
  const catMeta = getCategoryMeta(category, categories)

  return (
    <div className="relative mt-2 flex min-h-[calc(100dvh-83px-env(safe-area-inset-bottom,0px))] w-full flex-col items-center px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-4" style={{ overscrollBehavior: 'contain', boxSizing: 'border-box' }}>
      {/* Sync indicator */}
      <div className="absolute right-4 top-4 flex items-center gap-1.5">
        <div
          className="h-[7px] w-[7px] rounded-full transition-colors duration-300"
          style={{
            background: !online ? '#FF9500' : synced === null ? '#8E8E93' : synced ? '#34C759' : '#FF9500',
          }}
        />
      </div>

      {phase === 'idle' ? (
        /* ═══════ IDLE STATE ═══════ */
        <div className="mt-2 flex w-full flex-col items-center justify-start gap-8">
          <div className="mx-auto w-full max-w-[361px] space-y-3">
            {/* Intention input */}
            {showIdleIntentionInput && (
              <div className="w-full">
                <input
                  type="text"
                  placeholder="What are you working on?"
                  value={intention}
                  onChange={(e) => handleIntentionChange(e.target.value)}
                  maxLength={120}
                  className="w-full rounded-xl border border-gray-300 bg-gray-100 px-3 py-2.5 text-sm text-black placeholder-gray-400 outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              </div>
            )}

            {/* Category chips */}
            <div className="hide-scrollbar flex gap-2 overflow-x-auto px-1">
              {categories.map(cat => {
                const selected = category === cat.name
                return (
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
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[15px] font-medium transition-colors duration-200 ${
                      selected
                        ? 'text-black dark:text-white'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                    style={selected ? { backgroundColor: `${cat.color}1A`, color: cat.color } : undefined}
                  >
                    <span
                      className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: cat.color }}
                    />
                    {cat.label}
                  </button>
                )
              })}
            </div>

            {/* Session type selector */}
            <Segmented strong rounded>
              {(['focus', 'break'] as SessionType[]).map(t => (
                <SegmentedButton
                  key={t}
                  strong
                  rounded
                  active={sessionType === t}
                  onClick={() => setSessionType(t)}
                >
                  {t === 'focus' ? 'Focus' : 'Rest'}
                </SegmentedButton>
              ))}
            </Segmented>
          </div>

          {/* Ring with time display INSIDE */}
          <div className="flex flex-col items-center gap-3">
            <ProgressRing
              progress={progress}
              color={ringColor}
              size={240}
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
              <span className="font-mono text-[48px] font-light leading-none text-black dark:text-white">
                {formatTime(displayMs)}
              </span>
            </ProgressRing>

            {/* Time range chip */}
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {(() => {
                const now = new Date()
                const end = new Date(now.getTime() + (customDurationMs || remainingMs))
                const fmt = (d: Date) => d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
                return `${fmt(now)} → ${fmt(end)}`
              })()}
            </span>
          </div>

          {/* START button */}
          <div className="flex w-full justify-center">
            <button
              onClick={startTimer}
              className="press-in w-full max-w-[361px] rounded-full bg-[#007AFF] py-[14px] text-[17px] font-semibold text-white active:scale-[0.97]"
              style={{ minHeight: 50, transition: 'transform 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
            >
              START SESSION
            </button>
          </div>

          {/* Todoist picker */}
          <div className="mx-auto w-full max-w-[361px]">
            <TodoistTasks
              selectedTaskId={todoistTaskId}
              onSelectTask={handleTodoistTaskSelect}
            />
          </div>
        </div>
      ) : (
        /* ═══════ ACTIVE STATE ═══════ */
        <div className="mt-2 flex w-full flex-col items-center gap-3">
          {/* Editable intention */}
          <input
            type="text"
            placeholder="Tap to add intention..."
            value={intention}
            onChange={(e) => {
              const value = e.target.value
              handleIntentionChange(value)
            }}
            maxLength={120}
            className="w-full max-w-[320px] rounded-xl border border-gray-300 bg-gray-100 px-3 py-2.5 text-sm text-black placeholder-gray-400 outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />

          {/* Phase label + category chip */}
          <div className="flex items-center justify-center gap-2">
            <p className={`m-0 text-[11px] font-semibold uppercase tracking-[1.4px] ${isOverflow ? 'text-orange-500' : 'text-black dark:text-white'}`}>
              {isOverflow ? 'OVERFLOW' : phase === 'paused' ? 'PAUSED' : sessionType === 'focus' ? 'FOCUS' : 'REST'}
            </p>
            <Chip
              outline
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
              className="!border-gray-400 dark:!border-gray-500 !text-black dark:!text-white"
            >
              <span
                slot="media"
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: catMeta.color }}
              />
              {catMeta.label}
            </Chip>
          </div>

          {/* Ring */}
          <ProgressRing
            progress={progress}
            color={ringColor}
            size={240}
            strokeWidth={8}
            interactive={false}
          >
            <div className="flex flex-col items-center">
              {isOverflow && (
                <span className="overflow-pulse mb-1 text-[13px] font-medium text-orange-500">+{formatTime(overflowMs)}</span>
              )}
              <span className="font-mono text-[48px] font-light leading-none text-black dark:text-white">
                {formatTime(displayMs)}
              </span>
            </div>
          </ProgressRing>

          {/* Controls */}
          <div className="flex items-center gap-3">
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

          {/* Abandon */}
          <Button clear small onClick={abandonSession} className="!min-h-[44px] !text-gray-500 hover:!text-red-500">
            <Square style={{ width: 14, height: 14, marginRight: 6 }} />
            Abandon
          </Button>

          {/* Save error */}
          {saveError && (
            <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {saveError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
