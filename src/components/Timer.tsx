'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, Square, SkipForward } from 'lucide-react'
import ProgressRing from './ProgressRing'
import IntentionInput from './IntentionInput'
import { useSettings } from '@/context/SettingsContext'
import { saveSession } from '@/lib/db'
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

export default function Timer() {
  const { settings } = useSettings()
  const [phase, setPhase] = useState<TimerPhase>('idle')
  const [sessionType, setSessionType] = useState<SessionType>('focus')
  const [intention, setIntention] = useState('')
  const [category, setCategory] = useState<Category>('development')
  const [remainingMs, setRemainingMs] = useState(settings.focusDuration * 60 * 1000)
  const [overflowMs, setOverflowMs] = useState(0)
  const [startedAt, setStartedAt] = useState<number>(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const startTimer = useCallback(() => {
    if (phase === 'idle') {
      setStartedAt(Date.now())
      setOverflowMs(0)
    }
    setPhase('running')
    intervalRef.current = setInterval(tick, 100)
  }, [phase, tick])

  const pauseTimer = useCallback(() => {
    setPhase('paused')
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const finishSession = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    const endedAt = Date.now()
    const actualMs = endedAt - startedAt
    const overflow = Math.max(0, overflowMs)

    await saveSession({
      id: crypto.randomUUID(),
      intention,
      category,
      type: sessionType,
      targetMs,
      actualMs,
      overflowMs: overflow,
      startedAt,
      endedAt,
      notes: '',
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
  }, [startedAt, overflowMs, intention, category, sessionType, targetMs, settings.soundEnabled, playChime])

  const abandonSession = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setPhase('idle')
    setRemainingMs(targetMs)
    setOverflowMs(0)
    setIntention('')
  }, [targetMs])

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
