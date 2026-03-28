'use client'

import { useRef, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'

interface ProgressRingProps {
  progress: number  // 0-1
  color: string
  size: number
  strokeWidth?: number
  children?: React.ReactNode
  interactive?: boolean
  onProgressChange?: (progress: number) => void
  onDragEnd?: (progress: number) => void
}

export default function ProgressRing({
  progress,
  color,
  size,
  strokeWidth = 6,
  children,
  interactive = false,
  onProgressChange,
  onDragEnd,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(progress, 1))

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

  // Compute thumb position
  const thumbAngle = progress * 2 * Math.PI - Math.PI / 2
  const thumbX = size / 2 + radius * Math.cos(thumbAngle)
  const thumbY = size / 2 + radius * Math.sin(thumbAngle)

  // Tick marks at 5-minute intervals (interactive only)
  const ticks = interactive ? Array.from({ length: 12 }, (_, i) => {
    const minuteFraction = ((i + 1) * 5) / 60
    const tickAngle = minuteFraction * 2 * Math.PI - Math.PI / 2
    const innerR = radius - strokeWidth * 1.2
    const outerR = radius + strokeWidth * 1.2
    return {
      x1: size / 2 + innerR * Math.cos(tickAngle),
      y1: size / 2 + innerR * Math.sin(tickAngle),
      x2: size / 2 + outerR * Math.cos(tickAngle),
      y2: size / 2 + outerR * Math.sin(tickAngle),
      major: (i + 1) % 3 === 0,
    }
  }) : []

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

        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--ring-track)"
          strokeWidth={strokeWidth}
        />

        {/* Tick marks (idle/interactive only) */}
        {ticks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke="var(--ring-track)"
            strokeWidth={tick.major ? 1.5 : 0.75}
            strokeLinecap="round"
          />
        ))}

        {/* Progress arc */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          filter={!interactive && progress > 0 ? 'url(#ring-glow)' : undefined}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />

        {/* Thumb (interactive only) */}
        {interactive && (
          <circle
            cx={thumbX}
            cy={thumbY}
            r={strokeWidth * 1.6}
            fill={color}
            stroke="white"
            strokeWidth={2.5}
            style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}
          />
        )}
      </svg>

      <div className="absolute inset-0 flex items-center justify-center" style={interactive ? { pointerEvents: 'none' } : undefined}>
        {children}
      </div>
    </div>
  )
}
