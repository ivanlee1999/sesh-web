'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock'
import { saveTimerState, loadTimerState, clearTimerState, enqueueSession, getRecentCategoryNames, markCategoryUsed, type QueuedSession } from '@/lib/local-store'
import { getCategoryMeta } from '@/lib/categories'
import { ensurePushSubscription, isInstalledPwa } from '@/lib/push-client'
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
  const [isMultipleOf5, setIsMultipleOf5] = useState(false)
  const multipleOf5TimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMultiplePulseMinuteRef = useRef<number | null>(null)
  const [customDurationMs, setCustomDurationMs] = useState(settings.focusDuration * 60 * 1000)
  const [activeTargetMs, setActiveTargetMs] = useState(settings.focusDuration * 60 * 1000)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [recentCategoryNames, setRecentCategoryNames] = useState<string[]>([])

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

  // Cleanup multipleOf5 timeout on unmount
  useEffect(() => {
    return () => {
      if (multipleOf5TimeoutRef.current) clearTimeout(multipleOf5TimeoutRef.current)
    }
  }, [])

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { startedAtRef.current = startedAt }, [startedAt])
  useEffect(() => { remainingMsRef.current = remainingMs }, [remainingMs])
  useEffect(() => { overflowMsRef.current = overflowMs }, [overflowMs])
  useEffect(() => { sessionTypeRef.current = sessionType }, [sessionType])
  useEffect(() => { intentionRef.current = intention }, [intention])
  useEffect(() => { categoryRef.current = category }, [category])

  useEffect(() => {
    const updateViewportSize = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight })
    }

    updateViewportSize()
    window.addEventListener('resize', updateViewportSize)

    return () => window.removeEventListener('resize', updateViewportSize)
  }, [])

  useEffect(() => {
    setRecentCategoryNames(getRecentCategoryNames())
  }, [])

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

  useEffect(() => {
    setRecentCategoryNames(getRecentCategoryNames())
  }, [])

  const rememberCategoryOrder = useCallback((nextCategory: Category) => {
    setRecentCategoryNames(markCategoryUsed(nextCategory))
  }, [])

  const sortedCategories = useMemo(() => {
    const recentOrder = new Map(recentCategoryNames.map((name, index) => [name, index]))

    return [...categories].sort((a, b) => {
      const aRecentIndex = recentOrder.get(a.name)
      const bRecentIndex = recentOrder.get(b.name)

      if (aRecentIndex !== undefined || bRecentIndex !== undefined) {
        if (aRecentIndex === undefined) return 1
        if (bRecentIndex === undefined) return -1
        if (aRecentIndex !== bRecentIndex) return aRecentIndex - bRecentIndex
      }

      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.label.localeCompare(b.label)
    })
  }, [categories, recentCategoryNames])

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
  const focusDurationMs = settings.focusDuration * 60 * 1000
  const breakDurationMs = settings.breakDuration * 60 * 1000

  const compactViewport = viewportSize.height > 0 && viewportSize.height <= 840
  const veryCompactViewport = viewportSize.height > 0 && viewportSize.height <= 760
  const narrowViewport = viewportSize.width > 0 && viewportSize.width <= 430
  const ringSize = (() => {
    if (!viewportSize.width || !viewportSize.height) return 288

    const widthBound = viewportSize.width - (narrowViewport ? 136 : 104)
    const heightBound = viewportSize.height - (veryCompactViewport ? 520 : compactViewport ? 500 : 440)
    return Math.max(208, Math.min(narrowViewport ? 268 : compactViewport ? 280 : 296, widthBound, heightBound))
  })()

  const targetMs = phase === 'idle' ? customDurationMs : activeTargetMs
  const wakeLockActive = settings.keepScreenAwake && (phase === 'running' || phase === 'overflow')
  const wakeLock = useScreenWakeLock(wakeLockActive)
  const requestWakeLock = wakeLock.request

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

  const selectIdleSessionType = useCallback((nextType: SessionType) => {
    const nextDurationMs = nextType === 'focus' ? focusDurationMs : breakDurationMs
    setSessionType(nextType)
    setCustomDurationMs(nextDurationMs)
    setActiveTargetMs(nextDurationMs)
    setRemainingMs(nextDurationMs)
    setOverflowMs(0)

    syncToServer({
      phase: 'idle',
      sessionType: nextType,
      intention,
      category,
      targetMs: nextDurationMs,
      remainingMs: nextDurationMs,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
      todoistTaskId: todoistTaskIdRef.current,
    })
  }, [breakDurationMs, category, focusDurationMs, intention, syncToServer])

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
        setSessionType('focus')
        setCustomDurationMs(focusDurationMs)
        setActiveTargetMs(focusDurationMs)
        setRemainingMs(focusDurationMs)
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
            setSessionType('focus')
            if (data.category) setCategory(data.category as Category)
            if (data.intention) setIntention(data.intention)
            setCustomDurationMs(focusDurationMs)
            setActiveTargetMs(focusDurationMs)
            setRemainingMs(focusDurationMs)
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
  }, [applyServerState, postSwMessage, focusDurationMs])

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
          suppressIdleResetRef.current = true
          setPhase('idle')
          setSessionType('focus')
          setCategory(data.category as Category)
          setCustomDurationMs(focusDurationMs)
          setActiveTargetMs(focusDurationMs)
          setRemainingMs(focusDurationMs)
          setOverflowMs(0)
          setStartedAt(0)
          setIntention(data.intention)
          setTodoistTaskId(null)
          postSwMessage('TIMER_STOPPED')
        } else if (data.phase === 'idle' && phaseRef.current === 'idle') {
          suppressIdleResetRef.current = true
          setSessionType('focus')
          setCategory(data.category as Category)
          setCustomDurationMs(focusDurationMs)
          setActiveTargetMs(focusDurationMs)
          setRemainingMs(focusDurationMs)
          setIntention(data.intention)
        }
      } catch { setSynced(false) }
    }, 2000)
    return () => clearInterval(poll)
  }, [applyServerState, postSwMessage, focusDurationMs])

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
          suppressIdleResetRef.current = true
          setPhase('idle')
          setSessionType('focus')
          setCategory(data.category as Category)
          setCustomDurationMs(focusDurationMs)
          setActiveTargetMs(focusDurationMs)
          setRemainingMs(focusDurationMs)
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
  }, [applyServerState, focusDurationMs])

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
    if (settings.keepScreenAwake) {
      // iOS is most reliable when the wake-lock request starts directly from
      // the Start/Resume tap, not later in a post-render effect.
      void requestWakeLock({ allowWhileInactive: true })
    }

    const isIdle = phaseRef.current === 'idle'
    const now = Date.now()
    const newStartedAt = isIdle ? now : startedAtRef.current
    const nextTargetMs = isIdle ? customDurationMsRef.current : activeTargetMsRef.current

    if (isIdle) {
      void ensurePushSubscription({ requestPermission: isInstalledPwa() }).catch(() => {})
      rememberCategoryOrder(category)
    }

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
  }, [tick, syncToServer, postSwMessage, sessionType, intention, category, remainingMs, overflowMs, settings.keepScreenAwake, requestWakeLock, rememberCategoryOrder])

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

      // Calendar sync is now handled server-side in POST /api/timer
      if (data.calendar?.error) {
        console.warn('[calendar] sync error:', data.calendar.error)
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

    setPhase('idle')
    setSessionType('focus')
    setCustomDurationMs(focusDurationMs)
    setRemainingMs(focusDurationMs)
    setActiveTargetMs(focusDurationMs)
    setOverflowMs(0)
    setIntention('')
    setTodoistTaskId(null)
    clearTimerState()
    postSwMessage('TIMER_STOPPED')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, intention, category, sessionType, activeTargetMs, overflowMs, settings.soundEnabled, focusDurationMs, playChime, postSwMessage, tick, syncToServer])

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
  const isFocusMode = sessionType === 'focus'
  const restAccentColor = '#34C759'
  const accentColor = isFocusMode ? catMeta.color : restAccentColor
  const idleModeLabel = isFocusMode ? 'FOCUS SESSION' : 'REST SESSION'
  const idleModeAccentClass = isFocusMode
    ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
  const [oledSaver, setOledSaver] = useState(false)
  const [oledSaverOffset, setOledSaverOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!wakeLockActive) setOledSaver(false)
  }, [wakeLockActive])

  useEffect(() => {
    if (!oledSaver) return
    const move = () => {
      setOledSaverOffset({
        x: Math.floor(Math.random() * 121) - 60,
        y: Math.floor(Math.random() * 121) - 60,
      })
    }
    move()
    const interval = window.setInterval(move, 60_000)
    return () => window.clearInterval(interval)
  }, [oledSaver])

  return (
    <div className="relative flex h-full min-h-full w-full flex-col items-center overflow-hidden px-4 pb-4 pt-3" style={{ overscrollBehavior: 'contain', boxSizing: 'border-box' }}>
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
        <div className="flex w-full flex-1 flex-col items-center overflow-hidden">
          <div className={`flex w-full flex-col items-center ${veryCompactViewport ? 'gap-2 pt-2' : compactViewport ? 'gap-3 pt-3' : 'gap-5 pt-6'}`}>
            <div className="flex items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
              {Array.from({ length: 8 }).map((_, index) => (
                <span
                  key={index}
                  className={`h-2.5 w-2.5 rounded-full ${index === 0 ? 'bg-gray-400 dark:bg-gray-400' : 'bg-current opacity-55'}`}
                />
              ))}
            </div>

            <div className={`flex w-full flex-col items-center text-center ${veryCompactViewport ? 'gap-2' : 'gap-3'}`}>
              <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${idleModeAccentClass}`}>
                {idleModeLabel}
              </div>

              <div className="inline-flex rounded-full border border-gray-200 bg-white p-1 shadow-[0_1px_4px_rgba(0,0,0,0.04)] dark:border-gray-700 dark:bg-gray-900">
                {(['focus', 'break'] as SessionType[]).map((type) => {
                  const active = sessionType === type
                  const label = type === 'focus' ? 'Focus' : 'Rest'
                  return (
                    <button
                      key={type}
                      type="button"
                      data-testid={type === 'focus' ? 'idle-mode-focus' : 'idle-mode-rest'}
                      onClick={() => selectIdleSessionType(type)}
                      className={`rounded-full px-4 py-2 text-[14px] font-medium transition-colors duration-150 ${
                        active
                          ? type === 'focus'
                            ? 'text-white shadow-sm'
                            : 'bg-emerald-600 text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                      style={active && type === 'focus' ? { backgroundColor: catMeta.color } : undefined}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              <h1 className={`${veryCompactViewport ? 'text-[24px]' : compactViewport ? 'text-[26px]' : 'text-[28px]'} font-normal tracking-[-0.04em] text-gray-700 dark:text-gray-100 sm:text-[34px]`}>
                {isFocusMode ? 'What\'s your focus?' : 'Ready to rest?'}
              </h1>

              <div
                data-testid="timer-category-selector"
                className="hide-scrollbar flex w-full items-center justify-start gap-2 overflow-x-auto px-4 [-webkit-overflow-scrolling:touch]"
              >
                {sortedCategories.map(cat => {
                  const selected = category === cat.name
                  return (
                    <button
                      key={cat.name}
                      onClick={() => {
                        setCategory(cat.name)
                        rememberCategoryOrder(cat.name)
                        syncToServer({
                          phase: 'idle', sessionType, intention, category: cat.name,
                          targetMs: customDurationMs, remainingMs: customDurationMs,
                          overflowMs: 0, startedAt: null, pausedAt: null,
                        })
                      }}
                      className={`flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-full border ${veryCompactViewport ? 'px-3 py-1.5 text-[13px]' : 'px-3.5 py-2 text-[14px]'} font-medium transition-colors duration-200 ${
                        selected
                          ? 'border-transparent text-white shadow-sm'
                          : 'border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
                      }`}
                      style={selected ? { backgroundColor: isFocusMode ? cat.color : restAccentColor } : undefined}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border border-white/40"
                        style={{ backgroundColor: selected ? 'rgba(255,255,255,0.9)' : cat.color }}
                      />
                      {cat.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {showIdleIntentionInput && (
              <div className={`w-full max-w-[390px] ${veryCompactViewport ? 'pt-0.5' : 'pt-1'}`}>
                <input
                  type="text"
                  placeholder="Intention"
                  value={intention}
                  onChange={(e) => handleIntentionChange(e.target.value)}
                  maxLength={120}
                  className={`w-full rounded-[18px] border border-gray-200 bg-white px-5 ${veryCompactViewport ? 'py-3' : 'py-3.5'} text-[16px] font-normal text-gray-700 placeholder-gray-300 shadow-[0_1px_4px_rgba(0,0,0,0.04)] outline-none focus:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 sm:px-6 sm:py-4 sm:text-[18px]`}
                />
              </div>
            )}
          </div>

          <div className={`flex w-full flex-1 flex-col items-center justify-center ${veryCompactViewport ? 'gap-1.5 pt-1.5' : compactViewport ? 'gap-2.5 pt-2' : 'gap-3 pt-4'}`}>
            <ProgressRing
              progress={progress}
              color={ringColor}
              size={ringSize}
              strokeWidth={14}
              interactive={true}
              onProgressChange={(p) => {
                const minutes = Math.max(1, Math.min(60, Math.round(p * 60)))
                const ms = minutes * 60 * 1000
                setCustomDurationMs(ms)
                setRemainingMs(ms)
                if (minutes % 5 === 0 && lastMultiplePulseMinuteRef.current !== minutes) {
                  lastMultiplePulseMinuteRef.current = minutes
                  setIsMultipleOf5(true)
                  if (multipleOf5TimeoutRef.current) clearTimeout(multipleOf5TimeoutRef.current)
                  multipleOf5TimeoutRef.current = setTimeout(() => setIsMultipleOf5(false), 400)
                } else if (minutes % 5 !== 0) {
                  lastMultiplePulseMinuteRef.current = null
                  setIsMultipleOf5(false)
                }
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
              <div className="flex w-full items-center justify-center px-6">
                <div className={`w-full max-w-[200px] rounded-[26px] border border-white/70 bg-white/90 ${veryCompactViewport ? 'px-4 py-2.5' : 'px-5 py-3'} text-center shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-gray-700/80 dark:bg-gray-900/85`}>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-400 dark:text-gray-500"
                    style={{ color: `${accentColor}CC` }}
                  >
                    {isFocusMode ? 'Focus length' : 'Rest length'}
                  </div>
                  <span className={`font-mono [font-variant-numeric:tabular-nums] ${veryCompactViewport ? 'text-[34px]' : compactViewport ? 'text-[36px]' : 'text-[40px]'} font-light leading-none tracking-[-0.06em] text-gray-600 transition-transform duration-150 dark:text-gray-100 ${isMultipleOf5 ? 'scale-110' : 'scale-100'}`}>
                    {formatTime(displayMs)}
                  </span>
                </div>
              </div>
            </ProgressRing>

            <div className="flex flex-col items-center text-center">
              <span className={`rounded-full border border-gray-200/80 bg-white/85 ${veryCompactViewport ? 'px-3 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]'} font-medium tracking-[0.04em] text-gray-500 shadow-[0_10px_24px_rgba(15,23,42,0.05)] backdrop-blur-sm dark:border-gray-700/80 dark:bg-gray-900/80 dark:text-gray-300 sm:text-[14px]`}>
                {(() => {
                  const now = new Date()
                  const end = new Date(now.getTime() + (customDurationMs || remainingMs))
                  const fmt = (d: Date) => d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
                  return `Ends ${fmt(end)}`
                })()}
              </span>
            </div>
          </div>

          <div className={`flex w-full flex-col items-center ${veryCompactViewport ? 'gap-2 pb-0 pt-2' : compactViewport ? 'gap-3 pb-1 pt-3' : 'gap-4 pb-2 pt-5'}`}>
            <button
              onClick={startTimer}
              className={`press-in w-full max-w-[360px] rounded-full px-8 ${veryCompactViewport ? 'py-[13px]' : 'py-[15px]'} text-[16px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_14px_30px_rgba(139,92,246,0.22)] active:scale-[0.97] sm:py-[17px] sm:text-[17px]`}
              style={{
                minHeight: veryCompactViewport ? 48 : compactViewport ? 52 : 58,
                transition: 'transform 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                backgroundColor: accentColor,
                boxShadow: `0 14px 30px ${accentColor}33`,
              }}
            >
              {isFocusMode ? 'START FOCUS' : 'START REST'}
            </button>

            <div className={`w-full max-w-[390px] ${veryCompactViewport ? 'scale-[0.97]' : ''} origin-top`}>
              <TodoistTasks
                selectedTaskId={todoistTaskId}
                onSelectTask={handleTodoistTaskSelect}
              />
            </div>

            <div className="sr-only">
              <Segmented strong rounded>
                {(['focus', 'break'] as SessionType[]).map(t => (
                  <SegmentedButton
                    key={t}
                    strong
                    rounded
                    active={sessionType === t}
                    onClick={() => selectIdleSessionType(t)}
                  >
                    {t === 'focus' ? 'Focus' : 'Rest'}
                  </SegmentedButton>
                ))}
              </Segmented>
            </div>
          </div>
        </div>
      ) : (
        /* ═══════ ACTIVE STATE ═══════ */
        <div className={`mt-2 flex w-full flex-col items-center ${veryCompactViewport ? 'gap-2.5' : compactViewport ? 'gap-3' : 'gap-4'}`}>
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
            className="w-full max-w-[360px] rounded-[24px] border border-gray-200/80 bg-white/90 px-5 py-3 text-[16px] text-black shadow-[0_14px_32px_rgba(15,23,42,0.06)] outline-none backdrop-blur-sm transition focus:border-blue-400 dark:border-gray-700/80 dark:bg-gray-900/85 dark:text-white dark:placeholder-gray-500"
          />


          {/* Phase label + category chip */}
          <div className={`flex flex-wrap items-center justify-center ${veryCompactViewport ? 'gap-2' : 'gap-2.5'}`}>
            <p className={`m-0 text-[11px] font-semibold uppercase tracking-[1.4px] ${isOverflow ? 'text-orange-500' : 'text-black dark:text-white'}`}>
              {isOverflow ? 'OVERFLOW' : phase === 'paused' ? 'PAUSED' : sessionType === 'focus' ? 'FOCUS' : 'REST'}
            </p>
            <Chip
              outline
              onClick={() => {
                const names = sortedCategories.map(c => c.name)
                const idx = names.indexOf(category)
                const next = names[(idx + 1) % names.length] || category
                setCategory(next)
                rememberCategoryOrder(next)
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
                style={{ backgroundColor: accentColor }}
              />
              {catMeta.label}
            </Chip>
          </div>

          {/* Ring */}
          <ProgressRing
            progress={progress}
            color={ringColor}
            size={Math.min(ringSize, narrowViewport ? 268 : 288)}
            strokeWidth={14}
            interactive={false}
          >
            <div className={`flex flex-col items-center rounded-[26px] border border-white/70 bg-white/85 ${veryCompactViewport ? 'px-4 py-3' : 'px-5 py-3.5'} shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-gray-700/80 dark:bg-gray-900/80`}>
              <span
                className="mb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-400 dark:text-gray-500"
                style={{ color: isOverflow ? '#f97316' : `${accentColor}CC` }}
              >
                {isOverflow ? 'Overtime' : phase === 'paused' ? 'Paused' : 'Remaining'}
              </span>
              {isOverflow && (
                <span className="overflow-pulse mb-1 text-[13px] font-medium text-orange-500">+{formatTime(overflowMs)}</span>
              )}
              <span className={`font-mono ${veryCompactViewport ? 'text-[38px]' : compactViewport ? 'text-[42px]' : 'text-[48px]'} font-light leading-none tracking-[-0.06em] text-gray-800 [font-variant-numeric:tabular-nums] dark:text-white`}>
                {formatTime(displayMs)}
              </span>
            </div>
          </ProgressRing>

          {/* Controls */}
          <div className={`flex w-full max-w-[360px] flex-wrap items-center justify-center ${veryCompactViewport ? 'gap-2' : 'gap-2.5'}`}>
            {(phase === 'running' || phase === 'overflow') && (
              <>
                <Button clear rounded onClick={pauseTimer} className="!min-h-[46px] !rounded-full !px-5 !text-[16px] !font-semibold !tracking-[0.02em]">
                  <Pause style={{ width: 18, height: 18, marginRight: 6 }} />
                  Pause
                </Button>
                <Button clear rounded onClick={finishSession} className="!min-h-[46px] !rounded-full !px-5 !text-[16px] !font-semibold !tracking-[0.02em]">
                  <SkipForward style={{ width: 18, height: 18, marginRight: 6 }} />
                  Finish
                </Button>
              </>
            )}
            {phase === 'paused' && (
              <>
                <Button rounded onClick={startTimer} className="!min-h-[46px] !rounded-full !px-5 !text-[16px] !font-semibold !tracking-[0.02em]">
                  <Play style={{ width: 16, height: 16, fill: '#fff', marginRight: 6 }} />
                  Resume
                </Button>
                <Button clear rounded onClick={finishSession} className="!min-h-[46px] !rounded-full !px-5 !text-[16px] !font-semibold !tracking-[0.02em]">
                  <SkipForward style={{ width: 18, height: 18, marginRight: 6 }} />
                  Finish
                </Button>
              </>
            )}
          </div>

          {wakeLockActive && (
            <div className="flex w-full max-w-[360px] flex-col items-center gap-1.5 text-center">
              <button
                type="button"
                onClick={() => setOledSaver(true)}
                className="rounded-full bg-black px-4 py-2 text-sm font-medium text-gray-400 shadow-[0_12px_30px_rgba(0,0,0,0.18)] active:scale-95 dark:bg-gray-900"
              >
                OLED saver
              </button>
              <p className="max-w-[300px] text-xs text-gray-500">
                Keep-awake: {wakeLock.status === 'on' ? 'on' : wakeLock.status}
                {wakeLock.error ? ` — ${wakeLock.error}` : ''}
              </p>
            </div>
          )}

          {/* Abandon */}
          <Button clear small onClick={abandonSession} className="!min-h-[44px] !rounded-full !px-4 !text-gray-500 hover:!text-red-500">
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

      {oledSaver && wakeLockActive && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black text-gray-700">
          <div
            className="select-none text-center transition-transform duration-1000 ease-out"
            style={{ transform: `translate(${oledSaverOffset.x}px, ${oledSaverOffset.y}px)` }}
          >
            <div className="font-mono text-[44px] font-light leading-none text-gray-500">
              {formatTime(displayMs)}
            </div>
            <div className="mt-2 text-xs uppercase tracking-[0.24em] text-gray-700">
              {isOverflow ? 'overflow' : sessionType === 'focus' ? 'focus' : 'rest'}
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setOledSaver(false)}
                className="rounded-full border border-gray-800 px-4 py-2 text-sm text-gray-600 active:scale-95"
              >
                Show app
              </button>
              <button
                type="button"
                onClick={phase === 'running' || phase === 'overflow' ? pauseTimer : startTimer}
                className="rounded-full border border-gray-800 px-4 py-2 text-sm text-gray-600 active:scale-95"
              >
                {phase === 'running' || phase === 'overflow' ? 'Pause' : 'Resume'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
