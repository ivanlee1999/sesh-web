'use client'

import { useRef, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'

interface ProgressRingProps {
  progress: number  // 0-1
  color: string
  size: number
  strokeWidth?: number  // default 5
  children?: React.ReactNode
  interactive?: boolean
  onProgressChange?: (progress: number) => void
  onDragEnd?: (progress: number) => void
}

export default function ProgressRing({
  progress,
  color,
  size,
  strokeWidth = 5,
  children,
  interactive = false,
  onProgressChange,
  onDragEnd,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(progress, 1))
  const cx = size / 2
  const cy = size / 2

  const svgRef = useRef<SVGSVGElement | null>(null)
  const draggingRef = useRef(false)
  const lastProgressRef = useRef(progress)

  const updateFromPoint = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current || !onProgressChange) return

    const rect = svgRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const dx = clientX - centerX
    const dy = clientY - centerY

    // Angle from 12 o'clock (top), clockwise
    let angle = Math.atan2(dx, -dy)
    if (angle < 0) angle += 2 * Math.PI

    const raw = angle / (2 * Math.PI)
    // Snap to whole minutes (1/60 increments), clamp 1-60 min
    const snapped = Math.max(1 / 60, Math.min(1, Math.round(raw * 60) / 60))
    lastProgressRef.current = snapped
    onProgressChange(snapped)
  }, [onProgressChange])

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive) return
    e.preventDefault()
    draggingRef.current = true
    updateFromPoint(e.clientX, e.clientY)
  }, [interactive, updateFromPoint])

  const handleTouchStart = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (!interactive) return
    draggingRef.current = true
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
      onDragEnd?.(lastProgressRef.current)
    }
  }, [onDragEnd])

  // Window-level mouse listeners for desktop drag
  useEffect(() => {
    if (!interactive) return

    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      updateFromPoint(e.clientX, e.clientY)
    }

    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false
        onDragEnd?.(lastProgressRef.current)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [interactive, updateFromPoint, onDragEnd])

  // Helper: angle in radians from 12 o'clock for a given fraction (0-1)
  const fractionToAngle = (frac: number) => frac * 2 * Math.PI - Math.PI / 2

  // Clock hand / thumb position
  const thumbAngle = fractionToAngle(progress)
  const thumbX = cx + radius * Math.cos(thumbAngle)
  const thumbY = cy + radius * Math.sin(thumbAngle)

  // --- Tick marks: 60 small + 12 large (always visible) ---
  const tickMarkRadius = radius // ticks sit at the ring radius
  const smallTickLen = 4
  const largeTickLen = 8
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const frac = i / 60
    const angle = fractionToAngle(frac)
    const isMajor = i % 5 === 0
    const len = isMajor ? largeTickLen : smallTickLen
    const outerR = tickMarkRadius
    const innerR = tickMarkRadius - len
    return {
      x1: cx + innerR * Math.cos(angle),
      y1: cy + innerR * Math.sin(angle),
      x2: cx + outerR * Math.cos(angle),
      y2: cy + outerR * Math.sin(angle),
      isMajor,
    }
  })

  // --- Minute numbers (interactive only) ---
  const numberRadius = radius + 16 // outside the ticks
  const minuteNumbers = Array.from({ length: 12 }, (_, i) => {
    const minute = (i + 1) * 5
    const frac = minute / 60
    const angle = fractionToAngle(frac)
    return {
      minute,
      x: cx + numberRadius * Math.cos(angle),
      y: cy + numberRadius * Math.sin(angle),
    }
  })

  // --- Filled wedge/sector path ---
  const clampedProgress = Math.min(Math.max(progress, 0), 1)
  const wedgePath = (() => {
    if (clampedProgress <= 0) return ''
    // Start at 12 o'clock
    const startAngle = -Math.PI / 2
    const endAngle = startAngle + clampedProgress * 2 * Math.PI
    const startX = cx + radius * Math.cos(startAngle)
    const startY = cy + radius * Math.sin(startAngle)
    const endX = cx + radius * Math.cos(endAngle)
    const endY = cy + radius * Math.sin(endAngle)
    const largeArc = clampedProgress > 0.5 ? 1 : 0

    // Full circle needs special handling
    if (clampedProgress >= 1) {
      // Draw full circle as two half-arcs
      const midX = cx + radius * Math.cos(startAngle + Math.PI)
      const midY = cy + radius * Math.sin(startAngle + Math.PI)
      return `M ${cx},${cy} L ${startX},${startY} A ${radius},${radius} 0 0,1 ${midX},${midY} A ${radius},${radius} 0 0,1 ${startX},${startY} Z`
    }

    return `M ${cx},${cy} L ${startX},${startY} A ${radius},${radius} 0 ${largeArc},1 ${endX},${endY} Z`
  })()

  // Clock hand line: from center to the ring edge
  const handEndX = cx + (radius - 2) * Math.cos(thumbAngle)
  const handEndY = cy + (radius - 2) * Math.sin(thumbAngle)

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        ref={svgRef}
        width={size}
        height={size}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={interactive ? { touchAction: 'none', cursor: 'pointer' } : undefined}
      >
        {/* Glow filter for active ring */}
        <defs>
          <filter id="ring-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Tick marks — always visible, clock-style */}
        {ticks.map((tick, i) => (
          <line
            key={`tick-${i}`}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={tick.isMajor ? 'var(--text-secondary)' : 'var(--text-tertiary)'}
            strokeWidth={tick.isMajor ? 1.5 : 0.5}
            strokeLinecap="round"
          />
        ))}

        {/* Filled wedge/sector — semi-transparent category color */}
        {clampedProgress > 0 && (
          <motion.path
            d={wedgePath}
            fill={`${color}26`}
            initial={false}
            animate={{ d: wedgePath }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        )}

        {/* Progress arc stroke on the outer edge */}
        <motion.circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          filter={!interactive && progress > 0 ? 'url(#ring-glow)' : undefined}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />

        {/* Minute numbers — interactive/idle only */}
        {interactive && minuteNumbers.map(({ minute, x, y }) => (
          <text
            key={`num-${minute}`}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--text-tertiary)"
            fontSize={10}
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {minute}
          </text>
        ))}

        {/* Clock hand + tip (interactive only, replaces thumb) */}
        {interactive && (
          <>
            <line
              x1={cx}
              y1={cy}
              x2={handEndX}
              y2={handEndY}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle
              cx={thumbX}
              cy={thumbY}
              r={3}
              fill={color}
            />
          </>
        )}
      </svg>

      <div className="absolute inset-0 flex items-center justify-center" style={interactive ? { pointerEvents: 'none' } : undefined}>
        {children}
      </div>
    </div>
  )
}
