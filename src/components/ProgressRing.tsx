'use client'

import { useRef, useCallback, useEffect, useMemo, useId } from 'react'
import { useSettings } from '@/context/SettingsContext'
import { haptic } from '@/lib/haptic'

// --- Magnetic detent constants (in minutes) ---
const DETENT_CAPTURE_BAND = 1.5  // snap TO detent when within ±1.5 min
const DETENT_RELEASE_BAND = 2.0  // break free when raw exceeds ±2 min

interface ProgressRingProps {
  progress: number  // 0-1
  color: string
  size: number
  strokeWidth?: number  // default 14
  children?: React.ReactNode
  interactive?: boolean
  onProgressChange?: (progress: number) => void
  onDragEnd?: (progress: number) => void
}

// --- Pure math helpers ---
function clamp(min: number, max: number, v: number) {
  return Math.max(min, Math.min(max, v))
}

/** Circular distance on a 0..period ring (handles wrap-around). */
function circularDistance(a: number, b: number, period: number = 60): number {
  const d = Math.abs(a - b)
  return Math.min(d, period - d)
}

function rawProgressFromPoint(
  clientX: number, clientY: number,
  rect: DOMRect,
): number {
  const dx = clientX - (rect.left + rect.width / 2)
  const dy = clientY - (rect.top + rect.height / 2)
  let angle = Math.atan2(dx, -dy)
  if (angle < 0) angle += 2 * Math.PI
  return angle / (2 * Math.PI)
}

function minuteFromProgress(p: number): number {
  return clamp(1, 60, Math.round(p * 60))
}

function progressFromMinute(m: number): number {
  return clamp(1, 60, m) / 60
}

/** Apply magnetic detent logic. Returns the snapped minute and updated lock state.
 *  rawMinute is in [0, 60] where 0 and 60 both represent the 12 o'clock position. */
function applyDetent(
  rawMinute: number,
  lockedDetent: number | null,
): { minute: number; lockedDetent: number | null } {
  // Treat 0 as 60 for detent purposes (full circle)
  const nearest5 = Math.round(rawMinute / 5) * 5
  const nearestDetent = nearest5 === 0 ? 60 : nearest5

  // If currently locked to a detent, stay until raw movement exceeds release band
  // Use circular distance so that the 60/0 boundary works correctly
  if (lockedDetent != null) {
    if (circularDistance(rawMinute, lockedDetent) <= DETENT_RELEASE_BAND) {
      return { minute: lockedDetent, lockedDetent }
    }
    // Release — fall through to normal logic
    lockedDetent = null
  }

  // Try to capture onto nearest 5-minute detent (circular distance for 60/0 wrap)
  if (nearestDetent >= 5 && nearestDetent <= 60 && circularDistance(rawMinute, nearestDetent) <= DETENT_CAPTURE_BAND) {
    return { minute: nearestDetent, lockedDetent: nearestDetent }
  }

  // No detent — return rounded minute, mapping 0 to 60
  const rounded = Math.round(rawMinute)
  return { minute: rounded <= 0 ? 60 : clamp(1, 60, rounded), lockedDetent: null }
}

// --- Audio tick feedback (iOS fallback) ---
let sharedAudioContext: AudioContext | null = null

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') return sharedAudioContext
  try {
    sharedAudioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    return sharedAudioContext
  } catch {
    return null
  }
}

function playTickSound(isMajor: boolean) {
  const ctx = getOrCreateAudioContext()
  if (!ctx) return
  // Resume if suspended (required by iOS after user gesture)
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(isMajor ? 1200 : 800, ctx.currentTime)
  gain.gain.setValueAtTime(isMajor ? 0.15 : 0.08, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isMajor ? 0.06 : 0.03))
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + (isMajor ? 0.06 : 0.03))
}

export default function ProgressRing({
  progress,
  color,
  size,
  strokeWidth = 14,
  children,
  interactive = false,
  onProgressChange,
  onDragEnd,
}: ProgressRingProps) {
  const { settings } = useSettings()
  const isDark = settings.darkMode
  const gradientId = useId()

  // Session-style colors
  const trackStroke = isDark ? '#2C2C2E' : '#F0F0F0'
  const tipBorderColor = isDark ? '#1c1c1e' : '#FFFFFF'
  const majorTickColor = isDark ? '#555555' : '#CCCCCC'
  const minorTickColor = isDark ? '#3A3A3C' : '#E0E0E0'

  const padding = strokeWidth + 4
  const radius = (size - padding * 2) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(progress, 1))
  const cx = size / 2
  const cy = size / 2

  const svgRef = useRef<SVGSVGElement | null>(null)
  const draggingRef = useRef(false)
  const lastEmittedMinuteRef = useRef(minuteFromProgress(progress))
  const lockedDetentMinuteRef = useRef<number | null>(null)

  // Derive current minute for visual emphasis
  const currentMinute = minuteFromProgress(progress)
  const activeMajorMinute = currentMinute % 5 === 0 ? currentMinute : null

  const emitFeedback = useCallback((newMinute: number, prevMinute: number) => {
    if (newMinute === prevMinute) return
    const isMajor = newMinute % 5 === 0
    // Cross-platform haptic: Android vibrate + iOS checkbox switch hack
    if (isMajor) {
      haptic.strong()
    } else {
      haptic()
    }
    // Audio tick for tactile feedback (always on — soundEnabled only controls completion chime)
    playTickSound(isMajor)
  }, [settings.soundEnabled])

  const updateFromPoint = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current || !onProgressChange) return
    const rect = svgRef.current.getBoundingClientRect()
    const raw = rawProgressFromPoint(clientX, clientY, rect)
    const rawMinute = raw * 60  // 0..60, where 0 = top of ring = 60 minutes

    const result = applyDetent(rawMinute, lockedDetentMinuteRef.current)
    lockedDetentMinuteRef.current = result.lockedDetent

    const snappedProgress = progressFromMinute(result.minute)

    // Emit feedback only on minute change
    emitFeedback(result.minute, lastEmittedMinuteRef.current)
    lastEmittedMinuteRef.current = result.minute

    onProgressChange(snappedProgress)
  }, [onProgressChange, emitFeedback])

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive) return
    e.preventDefault()
    draggingRef.current = true
    lockedDetentMinuteRef.current = null  // reset lock on new drag
    updateFromPoint(e.clientX, e.clientY)
  }, [interactive, updateFromPoint])

  const handleTouchStart = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (!interactive) return
    draggingRef.current = true
    lockedDetentMinuteRef.current = null  // reset lock on new drag
    updateFromPoint(e.touches[0].clientX, e.touches[0].clientY)
  }, [interactive, updateFromPoint])

  const handleTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return
    e.preventDefault()
    updateFromPoint(e.touches[0].clientX, e.touches[0].clientY)
  }, [updateFromPoint])

  const handleTouchEnd = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current = false
      lockedDetentMinuteRef.current = null
      onDragEnd?.(progressFromMinute(lastEmittedMinuteRef.current))
    }
  }, [onDragEnd])

  useEffect(() => {
    if (!interactive) return
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      updateFromPoint(e.clientX, e.clientY)
    }
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false
        lockedDetentMinuteRef.current = null
        onDragEnd?.(progressFromMinute(lastEmittedMinuteRef.current))
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [interactive, updateFromPoint, onDragEnd])

  const fractionToAngle = (frac: number) => frac * 2 * Math.PI - Math.PI / 2

  // --- Tick marks (刻度) ---
  const ticks = useMemo(() => Array.from({ length: 60 }, (_, i) => {
    const angle = fractionToAngle(i / 60)
    const isMajor = i % 5 === 0
    const outerR = radius + strokeWidth / 2 - 1
    const innerR = isMajor ? outerR - 10 : outerR - 5
    return {
      x1: cx + innerR * Math.cos(angle),
      y1: cy + innerR * Math.sin(angle),
      x2: cx + outerR * Math.cos(angle),
      y2: cy + outerR * Math.sin(angle),
      isMajor,
      minute: i === 0 ? 60 : i,  // tick 0 = 60 minutes (12 o'clock)
    }
  }), [radius, strokeWidth, cx, cy])

  // --- Filled wedge path ---
  const clampedProgress = Math.min(Math.max(progress, 0), 1)
  const wedgePath = useMemo(() => {
    if (clampedProgress <= 0) return ''
    const startAngle = -Math.PI / 2
    const endAngle = startAngle + clampedProgress * 2 * Math.PI
    const sX = cx + radius * Math.cos(startAngle)
    const sY = cy + radius * Math.sin(startAngle)
    const eX = cx + radius * Math.cos(endAngle)
    const eY = cy + radius * Math.sin(endAngle)
    const la = clampedProgress > 0.5 ? 1 : 0
    if (clampedProgress >= 1) {
      const mX = cx + radius * Math.cos(startAngle + Math.PI)
      const mY = cy + radius * Math.sin(startAngle + Math.PI)
      return `M ${cx},${cy} L ${sX},${sY} A ${radius},${radius} 0 0,1 ${mX},${mY} A ${radius},${radius} 0 0,1 ${sX},${sY} Z`
    }
    return `M ${cx},${cy} L ${sX},${sY} A ${radius},${radius} 0 ${la},1 ${eX},${eY} Z`
  }, [clampedProgress, cx, cy, radius])

  // --- Tip dot position ---
  const tipAngle = fractionToAngle(progress)
  const tipX = cx + radius * Math.cos(tipAngle)
  const tipY = cy + radius * Math.sin(tipAngle)

  const wedgeGradientId = `${gradientId}-wedge`
  const glowFilterId = `${gradientId}-glow`
  const tickGlowFilterId = `${gradientId}-tickglow`

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        height="100%"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={interactive ? { touchAction: 'none', cursor: 'pointer' } : undefined}
      >
        <defs>
          {/* Wedge fill — very subtle tint */}
          <radialGradient id={wedgeGradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.05" />
            <stop offset="70%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0.18" />
          </radialGradient>

          {/* Glow blur for the arc */}
          <filter id={glowFilterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Glow filter for active major tick */}
          <filter id={tickGlowFilterId} x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Track — subtle background ring */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={trackStroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Tick marks */}
        {ticks.map((tick, i) => {
          const isActiveMajor = interactive && tick.isMajor && tick.minute === activeMajorMinute
          return (
            <line
              key={i}
              x1={tick.x1} y1={tick.y1}
              x2={tick.x2} y2={tick.y2}
              stroke={isActiveMajor ? color : tick.isMajor ? majorTickColor : minorTickColor}
              strokeWidth={isActiveMajor ? 3 : tick.isMajor ? 2 : 1}
              strokeLinecap="round"
              opacity={isActiveMajor ? 1 : 0.9}
              filter={isActiveMajor ? `url(#${tickGlowFilterId})` : undefined}
              data-active-major={isActiveMajor ? 'true' : undefined}
            />
          )
        })}

        {/* Wedge fill */}
        {clampedProgress > 0 && (
          <path
            d={wedgePath}
            fill={`url(#${wedgeGradientId})`}
            style={{ transition: interactive ? 'none' : 'd 0.3s ease' }}
          />
        )}

        {/* Glow layer — blurred arc behind the real one */}
        {clampedProgress > 0 && (
          <circle
            cx={cx} cy={cy} r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth + 8}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
            opacity={0.25}
            filter={`url(#${glowFilterId})`}
            style={{ transition: interactive ? 'none' : 'stroke-dashoffset 0.5s ease' }}
          />
        )}

        {/* Progress arc — thick, solid */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: interactive ? 'none' : 'stroke-dashoffset 0.5s ease' }}
        />

        {/* Tip dot — only in interactive/idle mode */}
        {clampedProgress > 0 && interactive && (
          <circle
            cx={tipX} cy={tipY}
            r={strokeWidth / 2 + 2}
            fill={color}
            stroke={tipBorderColor}
            strokeWidth={3}
          />
        )}
      </svg>

      <div className="absolute inset-0 flex items-center justify-center" style={interactive ? { pointerEvents: 'none' } : undefined}>
        {children}
      </div>
    </div>
  )
}
