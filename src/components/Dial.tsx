'use client'

import { useCallback, useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

/**
 * The session dial.
 *
 * A category-colored elapsed fill and clear progress rim keep the countdown
 * readable. Idle duration supports both pointer and keyboard adjustment.
 */

const MINUTES_ON_FACE = 60

export interface DialProps {
  /** 0–1. Idle shows the length being set; live shows the part already spent. */
  progress: number
  /** Category colour, already resolved for the ground it is drawn on. */
  color: string
  size: number
  /** A session is running or paused: the second hand and glow appear. */
  live?: boolean
  /** Drives the second hand. Ignored when not live. */
  elapsedSec?: number
  /** Deepens the drop shadow and is assumed by the caller's colour choice. */
  darkGround?: boolean
  /** Suppresses the minute hand's easing so it tracks the finger exactly. */
  dragging?: boolean
  /** Absent means the dial is not interactive (it is live). */
  onMinutesChange?: (minutes: number) => void
  onDragStart?: () => void
  onDragEnd?: (minutes: number) => void
  ariaLabel?: string
  children?: ReactNode
}

/**
 * Where a pointer sits on the face, in minutes.
 *
 * `atan2(dx, -dy)` puts 0 at noon and runs clockwise, which is the same thing
 * the numerals and the hands assume.
 */
function pointerMinutes(clientX: number, clientY: number, rect: DOMRect): number {
  const dx = clientX - (rect.left + rect.width / 2)
  const dy = clientY - (rect.top + rect.height / 2)
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI
  if (deg < 0) deg += 360
  return (deg / 360) * MINUTES_ON_FACE
}

export function clampDialMinutes(minutes: number): number {
  return Math.min(60, Math.max(1, Math.round(minutes)))
}

export default function Dial({
  progress,
  color,
  size,
  live = false,
  darkGround = false,
  onMinutesChange,
  onDragStart,
  onDragEnd,
  ariaLabel,
  children,
}: DialProps) {
  const p = Math.min(1, Math.max(0, progress))
  const c = size / 2
  const r = c - 26
  const circ = 2 * Math.PI * r
  /**
   * Every weight on the face is quoted against the 250px phone dial and scaled
   * from there. The handoff's desktop numbers are exactly the phone ones times
   * 226/250, so this reproduces both reference sizes and keeps the face
   * balanced at any other one. The radial insets below stay fixed, as the
   * handoff specifies — a bigger dial gets a proportionally thinner margin,
   * not a bigger one.
   */
  const scale = size / 250
  const arcW = 8 * scale
  const interactive = Boolean(onMinutesChange) && !live

  const draggingRef = useRef(false)

  // The elapsed wedge, drawn inside the index. A full circle needs its own
  // path: a 360° arc collapses to nothing when start and end coincide.
  const rw = r - 10
  const th = p * 2 * Math.PI
  const wedgePath = p >= 0.9995
    ? `M ${c} ${c - rw} A ${rw} ${rw} 0 1 1 ${c - 0.01} ${c - rw} Z`
    : `M ${c} ${c} L ${c + rw} ${c} A ${rw} ${rw} 0 ${p > 0.5 ? 1 : 0} 1 ${c + rw * Math.cos(th)} ${c + rw * Math.sin(th)} Z`

  const wedgeId = `sesh-wedge${useId().replace(/:/g, '')}`

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || !onMinutesChange) return
    const el = event.currentTarget
    const rect = el.getBoundingClientRect()

    event.preventDefault()
    try { el.setPointerCapture(event.pointerId) } catch { /* not every engine has it */ }

    draggingRef.current = true
    onDragStart?.()
    let latest = clampDialMinutes(pointerMinutes(event.clientX, event.clientY, rect))
    onMinutesChange(latest)

    const move = (moveEvent: PointerEvent) => {
      if (!draggingRef.current) return
      latest = clampDialMinutes(pointerMinutes(moveEvent.clientX, moveEvent.clientY, rect))
      onMinutesChange(latest)
    }

    const cleanup = () => {
      draggingRef.current = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }

    const up = (upEvent: PointerEvent) => {
      latest = clampDialMinutes(pointerMinutes(upEvent.clientX, upEvent.clientY, rect))
      cleanup()
      onDragEnd?.(latest)
    }

    const cancel = () => {
      cleanup()
      onDragEnd?.(latest)
    }

    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }, [interactive, onDragEnd, onDragStart, onMinutesChange])

  return (
    <div
      className="md-dial"
      data-testid="timer-duration-dial"
      role={interactive ? 'slider' : undefined}
      aria-label={ariaLabel}
      aria-valuemin={interactive ? 1 : undefined}
      aria-valuemax={interactive ? 60 : undefined}
      aria-valuenow={interactive ? Math.round(p * 60) : undefined}
      aria-valuetext={interactive ? `${Math.round(p * 60)} minutes` : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={event => {
        if (!interactive || !onMinutesChange) return
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
        if (!delta && event.key !== 'Home' && event.key !== 'End') return
        event.preventDefault()
        const minutes = event.key === 'Home' ? 1 : event.key === 'End' ? 60 : clampDialMinutes(p * 60 + delta)
        onMinutesChange(minutes)
        onDragEnd?.(minutes)
      }}
      onPointerDown={handlePointerDown}
      style={{ width: size, height: size, cursor: interactive ? 'grab' : 'default' }}
    >
      {live && (
        <span
          aria-hidden="true"
          className="md-breathe"
          style={{
            position: 'absolute',
            inset: '-8%',
            background: 'radial-gradient(circle, var(--color-accent-200) 0%, transparent 66%)',
            pointerEvents: 'none',
          }}
        />
      )}

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          position: 'relative',
          display: 'block',
          transform: 'rotate(-90deg)',
          overflow: 'visible',
          filter: darkGround
            ? 'drop-shadow(0 12px 28px rgba(0,0,0,.42))'
            : 'drop-shadow(0 8px 22px rgba(29,28,27,.10))',
        }}
      >
        <defs>
          <radialGradient id={wedgeId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.10" />
            <stop offset="64%" stopColor={color} stopOpacity="0.38" />
            <stop offset="100%" stopColor={color} stopOpacity="0.38" />
          </radialGradient>
        </defs>
        <path
          d={wedgePath}
          fill={`url(#${wedgeId})`}
          opacity={live ? 1 : 0.9}
          style={{ transition: 'opacity 320ms var(--ease-out)' }}
        />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeOpacity="0.14" strokeWidth={arcW} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={arcW}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - p)}
          style={{ transition: 'stroke-dashoffset 900ms linear, stroke 320ms var(--ease-out)' }}
        />
      </svg>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        {children}
      </div>

    </div>
  )
}
