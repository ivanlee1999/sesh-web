'use client'

import { useCallback, useId, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

/**
 * The dial, as a real clock.
 *
 * A Bauhaus 60-minute face in the Junghans Max Bill / Braun AB1 lineage: a
 * hairline index with numerals outside it, needle hands over a soft elapsed
 * wedge, and the progress arc demoted to a thin rim line. There is no grey
 * track ring — the index *is* the track, which is what keeps the face reading
 * as a clock rather than as a gauge.
 *
 * Layer order, bottom to top: wedge → index → arc (all inside one SVG rotated
 * −90°, so 0 is at noon) → numerals → hands → hub → readout. The numerals and
 * hands sit in their own unrotated layers so type stays upright and each hand
 * can carry its own rotation.
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
  elapsedSec = 0,
  darkGround = false,
  dragging = false,
  onMinutesChange,
  onDragStart,
  onDragEnd,
  ariaLabel,
  children,
}: DialProps) {
  const p = Math.min(1, Math.max(0, progress))
  const c = size / 2
  const r = c - 26
  const rNum = r + 15
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
  const arcW = 3.5 * scale
  const tickOuter = r - 7
  const interactive = Boolean(onMinutesChange) && !live

  const draggingRef = useRef(false)

  const ticks = []
  for (let i = 0; i < 60; i += 1) {
    const major = i % 5 === 0
    const len = major ? 8 : 3.5
    const a = (i / 60) * 2 * Math.PI
    const sin = Math.sin(a)
    const cos = Math.cos(a)
    const passed = i / 60 <= p + 1e-6
    ticks.push(
      <line
        key={i}
        x1={c + (tickOuter - len) * cos}
        y1={c + (tickOuter - len) * sin}
        x2={c + tickOuter * cos}
        y2={c + tickOuter * sin}
        stroke={passed ? color : 'var(--color-text)'}
        strokeWidth={(major ? 1.5 : 0.9) * scale}
        opacity={passed ? (major ? 0.95 : 0.6) : major ? 0.38 : 0.14}
        style={{ transition: 'stroke 400ms var(--ease-out), opacity 400ms' }}
      />,
    )
  }

  // The elapsed wedge, drawn inside the index. A full circle needs its own
  // path: a 360° arc collapses to nothing when start and end coincide.
  const rw = r - 10
  const th = p * 2 * Math.PI
  const wedgePath = p >= 0.9995
    ? `M ${c} ${c - rw} A ${rw} ${rw} 0 1 1 ${c - 0.01} ${c - rw} Z`
    : `M ${c} ${c} L ${c + rw} ${c} A ${rw} ${rw} 0 ${p > 0.5 ? 1 : 0} 1 ${c + rw * Math.cos(th)} ${c + rw * Math.sin(th)} Z`

  const wedgeId = `sesh-wedge${useId().replace(/:/g, '')}`

  const numerals = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map(minute => {
    const a = (minute / 60) * 2 * Math.PI
    const passed = minute / 60 <= p + 1e-6
    const style: CSSProperties = {
      position: 'absolute',
      left: c + rNum * Math.sin(a),
      top: c - rNum * Math.cos(a),
      transform: 'translate(-50%,-50%)',
      lineHeight: 1,
      fontFamily: 'var(--font-heading)',
      fontWeight: minute % 15 === 0 ? 700 : 600,
      fontSize: 9.5 * scale,
      fontVariantNumeric: 'tabular-nums',
      letterSpacing: '.04em',
      color: passed ? color : 'var(--color-text-3)',
      opacity: passed ? 0.95 : 0.7,
      transition: 'color 420ms var(--ease-out), opacity 420ms',
    }
    return <span key={minute} style={style}>{minute}</span>
  })

  const handPoints = (() => {
    const tip = r - 16
    const tail = 13 * scale
    const hw = 1.25 * scale
    return [
      [c - hw, c - tip], [c + hw, c - tip], [c + hw, c + tail], [c - hw, c + tail],
    ].map(pt => pt.map(n => n.toFixed(2)).join(',')).join(' ')
  })()

  const secPoints = (() => {
    const tip = r - 8
    const tail = 16 * scale
    const hw = 0.5 * scale
    return [
      [c - hw, c - tip], [c + hw, c - tip], [c + hw, c + tail], [c - hw, c + tail],
    ].map(pt => pt.map(n => n.toFixed(2)).join(',')).join(' ')
  })()

  const secDeg = (Math.floor(elapsedSec) % 60) * 6

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
            <stop offset="0%" stopColor={color} stopOpacity="0.03" />
            <stop offset="64%" stopColor={color} stopOpacity="0.11" />
            <stop offset="100%" stopColor={color} stopOpacity="0.24" />
          </radialGradient>
        </defs>
        <path
          d={wedgePath}
          fill={`url(#${wedgeId})`}
          opacity={live ? 1 : 0.9}
          style={{ transition: 'opacity 320ms var(--ease-out)' }}
        />
        {ticks}
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

      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {numerals}
      </div>

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none', overflow: 'visible' }}
      >
        <g
          style={{
            transform: `rotate(${p * 360}deg)`,
            transformOrigin: `${c}px ${c}px`,
            transition: dragging
              ? 'none'
              : live ? 'transform .95s linear' : 'transform 260ms var(--ease-out)',
          }}
        >
          <polygon points={handPoints} fill="var(--color-text)" />
        </g>
        {live && (
          <g
            style={{
              transform: `rotate(${secDeg}deg)`,
              transformOrigin: `${c}px ${c}px`,
              // Crossing zero must not sweep the long way round.
              transition: secDeg === 0 ? 'none' : 'transform .95s linear',
            }}
          >
            <polygon points={secPoints} fill={color} />
          </g>
        )}
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

      {/* Over the digits, as a hub cap sits over the hands. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 8 * scale,
          height: 8 * scale,
          marginLeft: -4 * scale,
          marginTop: -4 * scale,
          borderRadius: '50%',
          background: 'var(--color-text)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
