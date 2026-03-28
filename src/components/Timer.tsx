'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, Square, SkipForward } from 'lucide-react'
import ProgressRing from './ProgressRing'
import IntentionInput from './IntentionInput'
import { useSettings } from '@/context/SettingsContext'
import type { Category, SessionType, TimerPhase } from '@/types'
import { CATEGORY_COLORS } from '@/types'
import clsx from 'clsx'

function formatTime(ms: number): string {
  const totalSec = Math.floor(Math.abs(ms) / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const PHASE_COLORS: Record<string, string> = {
  focus: '#22c55e',
  'short-break': '#06b6d4',
  'long-break': '#06b6d4',
  overflow: '#f59e0b',
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
}

export default function Timer() {
  const { settings } = useSettings()
  const [phase, setPhase] = useState<TimerPhase>('idle')
  const [sessionType, setSessionType] = useState<SessionType>('focus')
  const [intention, setIntention] = useState('')
  const [category, setCategory] = useState<Category>('development')
  const [remainingMs, setRemainingMs] = useState(settings.focusDuration * 60 * 1000)
  const [overflowMs, setOverflowMs] = useState(0)
  const [startedAt, setStartedAt] = useState<number>(0)
  const [synced, setSynced] = useState<boolean | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Idle dial state — separate from active countdown target
  const [customDurationMs, setCustomDurationMs] = useState(settings.focusDuration * 60 * 1000)
  const [activeTargetMs, setActiveTargetMs] = useState(settings.focusDuration * 60 * 1000)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPutRef = useRef<number>(0)
  // Refs for values needed in polling closure / debounced callbacks without causing re-renders
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

  const customDurationMsRef = useRef(customDurationMs)
  useEffect(() => { customDurationMsRef.current = customDurationMs }, [customDurationMs])
  const activeTargetMsRef = useRef(activeTargetMs)
  useEffect(() => { activeTargetMsRef.current = activeTargetMs }, [activeTargetMs])
  // When true, the idle-reset effect skips one cycle so server-driven
  // reconciliation isn't immediately clobbered by the defaultDurationMs reset.
  const suppressIdleResetRef = useRef(false)

  const defaultDurationMs = sessionType === 'focus'
    ? settings.focusDuration * 60 * 1000
    : sessionType === 'short-break'
    ? settings.shortBreakDuration * 60 * 1000
    : settings.longBreakDuration * 60 * 1000

  // targetMs is kept for buildTimerPayload backward compat during active sessions
  const targetMs = phase === 'idle' ? customDurationMs : activeTargetMs

  // Sync idle dial when settings or session type changes.
  // Server-driven reconciliation sets suppressIdleResetRef to avoid clobbering
  // a custom duration that was just fetched from the API.
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

  // Post a message to the service worker (for background polling control)
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
    lastPutRef.current = Date.now()
    try {
      const res = await fetch('/api/timer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setSynced(false)
        return
      }
      const data: ServerTimerState = await res.json()
      serverUpdatedAtRef.current = data.updatedAt
      setSynced(true)
    } catch {
      setSynced(false)
    }
  }, [])

  // Apply server state to local state (used on mount + polling)
  const applyServerState = useCallback((data: ServerTimerState) => {
    if (data.phase === 'running' && data.startedAt) {
      const newRemaining = data.targetMs - (Date.now() - data.startedAt)
      if (intervalRef.current) clearInterval(intervalRef.current)
      setPhase(newRemaining > 0 ? 'running' : 'overflow')
      setSessionType(data.sessionType as SessionType)
      setIntention(data.intention)
      setCategory(data.category as Category)
      setRemainingMs(newRemaining)
      setOverflowMs(newRemaining > 0 ? data.overflowMs : Math.abs(newRemaining))
      setStartedAt(data.startedAt)
      setActiveTargetMs(data.targetMs)
      intervalRef.current = setInterval(tick, 100)
    } else if (data.phase === 'paused') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setPhase('paused')
      setSessionType(data.sessionType as SessionType)
      setIntention(data.intention)
      setCategory(data.category as Category)
      setRemainingMs(data.remainingMs)
      setOverflowMs(data.overflowMs)
      setActiveTargetMs(data.targetMs)
      if (data.startedAt) setStartedAt(data.startedAt)
    }
  }, [tick])

  // On mount: fetch server state and resume if a timer is active
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/timer')
        if (!res.ok) { setSynced(false); return }
        const data: ServerTimerState = await res.json()
        setSynced(true)
        serverUpdatedAtRef.current = data.updatedAt
        if (data.phase === 'running' || data.phase === 'paused') {
          applyServerState(data)
          // Ensure the SW resumes background polling after page reload
          postSwMessage('TIMER_STARTED')
        } else {
          // Reconcile idle state from server (e.g. another client set a custom duration)
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
      }
    }
    init()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (intentionSyncTimeoutRef.current) clearTimeout(intentionSyncTimeoutRef.current)
    }
  }, [applyServerState, postSwMessage])

  // Poll every 2s — apply server state if phase or startedAt changed (cross-device sync)
  useEffect(() => {
    const poll = setInterval(async () => {
      // Skip if we just PUT (within 3s) to avoid overriding our own updates
      if (Date.now() - lastPutRef.current < 3000) return
      try {
        const res = await fetch('/api/timer')
        if (!res.ok) { setSynced(false); return }
        const data: ServerTimerState = await res.json()
        setSynced(true)

        // Ignore if server state hasn't changed since our last known update
        if (data.updatedAt <= serverUpdatedAtRef.current) return

        serverUpdatedAtRef.current = data.updatedAt

        if (data.phase === 'running' || data.phase === 'paused') {
          applyServerState(data)
        } else if (data.phase === 'idle' && phaseRef.current !== 'idle') {
          // Server auto-completed (or another client finished) — full reset
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
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
          postSwMessage('TIMER_STOPPED')
        } else if (data.phase === 'idle' && phaseRef.current === 'idle') {
          // Another client changed idle state (e.g. dragged duration) — apply it
          const idleDuration = data.remainingMs || data.targetMs
          suppressIdleResetRef.current = true
          setSessionType(data.sessionType as SessionType)
          setCategory(data.category as Category)
          setCustomDurationMs(idleDuration)
          setActiveTargetMs(idleDuration)
          setRemainingMs(idleDuration)
          setIntention(data.intention)
        }
      } catch {
        setSynced(false)
      }
    }, 2000)
    return () => clearInterval(poll)
  }, [applyServerState, postSwMessage])

  // Re-sync from server when app becomes visible (iOS PWA resume)
  useEffect(() => {
    let lastResync = 0
    const resync = async () => {
      // Debounce: skip if we resynced within the last 500ms
      const now = Date.now()
      if (now - lastResync < 500) return
      lastResync = now
      try {
        const res = await fetch('/api/timer', { cache: 'no-store' })
        if (!res.ok) return
        const data: ServerTimerState = await res.json()
        setSynced(true)
        serverUpdatedAtRef.current = data.updatedAt
        if (data.phase === 'running' || data.phase === 'paused') {
          applyServerState(data)
        } else if (data.phase === 'idle') {
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
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

    if (intentionSyncTimeoutRef.current) {
      clearTimeout(intentionSyncTimeoutRef.current)
    }

    intentionSyncTimeoutRef.current = setTimeout(() => {
      syncToServer(buildTimerPayload({
        intention: value,
        pausedAt: phaseRef.current === 'paused' ? Date.now() : null,
      }))
    }, 500)
  }, [buildTimerPayload, syncToServer])

  const handleCategoryChange = useCallback((value: Category) => {
    setCategory(value)

    if (phaseRef.current === 'idle') return

    syncToServer(buildTimerPayload({
      category: value,
      pausedAt: phaseRef.current === 'paused' ? Date.now() : null,
    }))
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
    })

    postSwMessage('TIMER_STARTED')
  }, [tick, syncToServer, postSwMessage, sessionType, intention, category, remainingMs, overflowMs])

  const pauseTimer = useCallback(() => {
    setPhase('paused')
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    syncToServer({
      phase: 'paused',
      sessionType,
      intention,
      category,
      targetMs,
      remainingMs,
      overflowMs,
      startedAt,
      pausedAt: Date.now(),
    })

    postSwMessage('TIMER_STOPPED')
  }, [syncToServer, postSwMessage, sessionType, intention, category, targetMs, remainingMs, overflowMs, startedAt])

  const finishSession = useCallback(async () => {
    if (intentionSyncTimeoutRef.current) {
      clearTimeout(intentionSyncTimeoutRef.current)
      intentionSyncTimeoutRef.current = null
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Atomically complete the timer on the server using compare-and-swap on
    // startedAt.  This prevents duplicate sessions when the background
    // auto-complete fires concurrently.
    try {
      const res = await fetch('/api/timer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startedAt,
          intention,
          category,
          notes: '',
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to save session')
      }

      const data = await res.json()

      // If the server reports the timer was already completed (by auto-complete
      // or another client), skip saving again but still reset the local UI.
      if (!data.completed) {
        // Session was already persisted — just reset UI below.
      }

      setSaveError(null)

      // Sync to Google Calendar (fire-and-forget) — only if we were the ones
      // who actually completed the session.
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

      // Update serverUpdatedAtRef so the polling loop doesn't fight us
      if (data.timer?.updatedAt) {
        serverUpdatedAtRef.current = data.timer.updatedAt
      }
    } catch {
      setSaveError('Failed to save session. Please try finishing again.')
      // Restart the interval so the timer keeps ticking
      intervalRef.current = setInterval(tick, 100)
      return
    }

    if (settings.soundEnabled) playChime()

    // Only show a local notification if the user does NOT have web push enabled.
    // The server already sends a web push on completion, so showing both would
    // cause a duplicate notification.
    if (Notification.permission === 'granted') {
      const hasPushSub = await (async () => {
        try {
          if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
          const reg = await navigator.serviceWorker.ready
          return !!(await reg.pushManager.getSubscription())
        } catch { return false }
      })()
      if (!hasPushSub) {
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
  }, [startedAt, intention, category, sessionType, defaultDurationMs, settings.soundEnabled, settings.calendarSync, playChime, postSwMessage, tick])

  const abandonSession = useCallback(() => {
    if (intentionSyncTimeoutRef.current) {
      clearTimeout(intentionSyncTimeoutRef.current)
      intentionSyncTimeoutRef.current = null
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setPhase('idle')
    setCustomDurationMs(defaultDurationMs)
    setRemainingMs(defaultDurationMs)
    setOverflowMs(0)
    setIntention('')
    syncToServer({
      phase: 'idle',
      sessionType,
      intention: '',
      category,
      targetMs: defaultDurationMs,
      remainingMs: defaultDurationMs,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
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

  // Notification permission is now managed via the Settings push toggle

  const isActive = phase === 'running' || phase === 'paused' || phase === 'overflow'
  const isOverflow = remainingMs < 0

  const displayMs = phase === 'idle'
    ? customDurationMs
    : isOverflow ? Math.abs(remainingMs) : remainingMs

  const progress = phase === 'idle'
    ? customDurationMs / (60 * 60 * 1000)
    : isOverflow ? 1 : Math.max(0, remainingMs / activeTargetMs)

  const ringColor = isOverflow ? PHASE_COLORS.overflow : (CATEGORY_COLORS[category] || PHASE_COLORS[sessionType])

  return (
    <div className="flex flex-col items-center px-4 pt-16 md:pt-20 gap-6">
      {/* Sync indicator */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <div
          className={clsx(
            'w-2 h-2 rounded-full transition-colors',
            synced === null ? 'bg-gray-300 dark:bg-gray-600' :
            synced ? 'bg-green-400' : 'bg-gray-400 dark:bg-gray-600'
          )}
          title={synced === null ? 'Connecting…' : synced ? 'Synced' : 'Offline'}
        />
      </div>

      {/* Session type tabs */}
      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1 w-full max-w-sm">
        {(['focus', 'short-break', 'long-break'] as SessionType[]).map(t => (
          <button
            key={t}
            disabled={isActive}
            onClick={() => setSessionType(t)}
            className={clsx(
              'flex-1 text-xs py-2 rounded-lg font-medium transition-all',
              sessionType === t
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400',
              isActive && 'opacity-50 cursor-not-allowed'
            )}
          >
            {t === 'focus' ? 'Focus' : t === 'short-break' ? 'Short Break' : 'Long Break'}
          </button>
        ))}
      </div>

      {/* Progress ring */}
      <ProgressRing
        progress={progress}
        color={ringColor}
        size={240}
        strokeWidth={10}
        interactive={phase === 'idle'}
        onProgressChange={(p) => {
          const minutes = Math.max(1, Math.min(60, Math.round(p * 60)))
          const ms = minutes * 60 * 1000
          setCustomDurationMs(ms)
          setRemainingMs(ms)
        }}
        onDragEnd={(p) => {
          // Persist idle duration to server only on drag end so we send a
          // single request with the final value instead of racing PUTs on
          // every pointer move.
          const minutes = Math.max(1, Math.min(60, Math.round(p * 60)))
          const ms = minutes * 60 * 1000
          syncToServer({
            phase: 'idle',
            sessionType: sessionTypeRef.current,
            intention: intentionRef.current,
            category: categoryRef.current,
            targetMs: ms,
            remainingMs: ms,
            overflowMs: 0,
            startedAt: null,
            pausedAt: null,
          })
        }}
      >
        <div className="flex flex-col items-center">
          {isOverflow && (
            <span className="text-xs text-amber-500 font-medium mb-1">overflow</span>
          )}
          <span className="font-mono text-5xl font-bold text-gray-900 dark:text-gray-100">
            {formatTime(displayMs)}
          </span>
          {isOverflow && (
            <span className="text-xs text-amber-400 mt-1">+{formatTime(overflowMs)}</span>
          )}
          <span className="text-xs text-gray-400 mt-2 capitalize">{phase}</span>
        </div>
      </ProgressRing>

      {/* Controls */}
      <div className="flex items-center gap-4">
        {phase === 'idle' && (
          <button
            onClick={startTimer}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-2xl font-semibold transition-colors shadow-md"
          >
            <Play className="w-5 h-5 fill-white" />
            Start
          </button>
        )}
        {(phase === 'running' || phase === 'overflow') && (
          <>
            <button
              onClick={pauseTimer}
              className="flex items-center gap-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 px-6 py-3 rounded-2xl font-semibold transition-colors"
            >
              <Pause className="w-5 h-5" />
              Pause
            </button>
            <button
              onClick={finishSession}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-2xl font-semibold transition-colors shadow-md"
            >
              <SkipForward className="w-5 h-5" />
              Finish
            </button>
          </>
        )}
        {phase === 'paused' && (
          <>
            <button
              onClick={startTimer}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-2xl font-semibold transition-colors shadow-md"
            >
              <Play className="w-5 h-5 fill-white" />
              Resume
            </button>
            <button
              onClick={finishSession}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-2xl font-semibold transition-colors"
            >
              <SkipForward className="w-5 h-5" />
              Finish
            </button>
          </>
        )}
        {isActive && (
          <button
            onClick={abandonSession}
            className="p-3 rounded-2xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 transition-colors"
            title="Abandon (Esc)"
          >
            <Square className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Save error */}
      {saveError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-2 text-sm text-red-600 dark:text-red-400">
          {saveError}
        </div>
      )}

      {/* Keyboard hints */}
      {phase === 'idle' && (
        <p className="text-xs text-gray-400">Drag ring to set duration · Enter to start</p>
      )}
      {isActive && (
        <p className="text-xs text-gray-400">Space to pause · Esc to abandon</p>
      )}

      {/* Intention + category */}
      <IntentionInput
        intention={intention}
        setIntention={handleIntentionChange}
        category={category}
        setCategory={handleCategoryChange}
      />
    </div>
  )
}
