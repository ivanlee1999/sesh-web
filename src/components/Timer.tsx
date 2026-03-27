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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPutRef = useRef<number>(0)
  // Refs for values needed in polling closure without causing re-renders
  const phaseRef = useRef<TimerPhase>('idle')
  const startedAtRef = useRef<number>(0)

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { startedAtRef.current = startedAt }, [startedAt])

  const targetMs = sessionType === 'focus'
    ? settings.focusDuration * 60 * 1000
    : sessionType === 'short-break'
    ? settings.shortBreakDuration * 60 * 1000
    : settings.longBreakDuration * 60 * 1000

  // Sync remaining when settings or type changes and idle
  useEffect(() => {
    if (phase === 'idle') {
      setRemainingMs(targetMs)
    }
  }, [settings.focusDuration, settings.shortBreakDuration, settings.longBreakDuration, sessionType, phase, targetMs])

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
      setSynced(res.ok)
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
        if (data.phase === 'running' || data.phase === 'paused') {
          applyServerState(data)
        }
      } catch {
        setSynced(false)
      }
    }
    init()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [applyServerState])

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

        const phaseChanged = data.phase !== phaseRef.current
        const startedAtChanged = data.startedAt !== startedAtRef.current

        if (!phaseChanged && !startedAtChanged) return

        if (data.phase === 'running' || data.phase === 'paused') {
          applyServerState(data)
        } else if (data.phase === 'idle' && phaseRef.current !== 'idle') {
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
          setPhase('idle')
          setOverflowMs(0)
          setIntention('')
        }
      } catch {
        setSynced(false)
      }
    }, 2000)
    return () => clearInterval(poll)
  }, [applyServerState])

  const startTimer = useCallback(() => {
    const isIdle = phaseRef.current === 'idle'
    const now = Date.now()
    const newStartedAt = isIdle ? now : startedAtRef.current

    if (isIdle) {
      setStartedAt(now)
      setOverflowMs(0)
    }
    setPhase('running')
    intervalRef.current = setInterval(tick, 100)

    syncToServer({
      phase: 'running',
      sessionType,
      intention,
      category,
      targetMs,
      remainingMs,
      overflowMs: isIdle ? 0 : overflowMs,
      startedAt: newStartedAt,
      pausedAt: null,
    })
  }, [tick, syncToServer, sessionType, intention, category, targetMs, remainingMs, overflowMs])

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
  }, [syncToServer, sessionType, intention, category, targetMs, remainingMs, overflowMs, startedAt])

  const finishSession = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    const endedAt = Date.now()
    const actualMs = endedAt - startedAt
    const overflow = Math.max(0, overflowMs)
    const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

    const sessionPayload = {
      id: sessionId,
      intention,
      category,
      type: sessionType,
      targetMs,
      actualMs,
      overflowMs: overflow,
      startedAt,
      endedAt,
      notes: '',
    }

    // Save to server — must succeed before resetting UI
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionPayload),
      })

      if (!res.ok) {
        throw new Error('Failed to save session')
      }

      setSaveError(null)
    } catch {
      setSaveError('Failed to save session. Please try finishing again.')
      // Restart the interval so the timer keeps ticking
      intervalRef.current = setInterval(tick, 100)
      return
    }

    // Sync to Google Calendar (fire-and-forget)
    if (settings.calendarSync) {
      fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intention,
          category,
          type: sessionType,
          startedAt,
          endedAt,
          targetMs,
          actualMs,
          overflowMs: overflow,
        }),
      }).catch(() => {})
    }

    // Reset server timer state
    syncToServer({
      phase: 'idle',
      sessionType,
      intention: '',
      category,
      targetMs,
      remainingMs: targetMs,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
    })

    if (settings.soundEnabled) playChime()

    if (Notification.permission === 'granted') {
      new Notification('sesh — session complete', {
        body: intention || `${sessionType} finished`,
        icon: '/icons/icon-192.png',
      })
    }

    if (navigator.vibrate) navigator.vibrate([200, 100, 200])

    setPhase('idle')
    setRemainingMs(targetMs)
    setOverflowMs(0)
    setIntention('')
  }, [startedAt, overflowMs, intention, category, sessionType, targetMs, settings.soundEnabled, settings.calendarSync, playChime, syncToServer, tick])

  const abandonSession = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setPhase('idle')
    setRemainingMs(targetMs)
    setOverflowMs(0)
    setIntention('')
    syncToServer({
      phase: 'idle',
      sessionType,
      intention: '',
      category,
      targetMs,
      remainingMs: targetMs,
      overflowMs: 0,
      startedAt: null,
      pausedAt: null,
    })
  }, [targetMs, syncToServer, sessionType, category])

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

  // Request notification permission
  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const isOverflow = remainingMs < 0
  const displayMs = isOverflow ? Math.abs(remainingMs) : remainingMs
  const progress = isOverflow ? 1 : Math.max(0, remainingMs / targetMs)
  const ringColor = isOverflow ? PHASE_COLORS.overflow : (CATEGORY_COLORS[category] || PHASE_COLORS[sessionType])
  const isActive = phase === 'running' || phase === 'paused' || phase === 'overflow'

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
      <ProgressRing progress={progress} color={ringColor} size={240} strokeWidth={10}>
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
        <p className="text-xs text-gray-400">Press Enter to start</p>
      )}
      {isActive && (
        <p className="text-xs text-gray-400">Space to pause · Esc to abandon</p>
      )}

      {/* Intention + category */}
      {!isActive && (
        <IntentionInput
          intention={intention}
          setIntention={setIntention}
          category={category}
          setCategory={setCategory}
        />
      )}
      {isActive && intention && (
        <div className="text-center max-w-xs">
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">&ldquo;{intention}&rdquo;</p>
        </div>
      )}
    </div>
  )
}
