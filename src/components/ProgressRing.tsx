'use client'

import { useRef, useCallback, useEffect, useMemo, useId } from 'react'
import { useSettings } from '@/context/SettingsContext'

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
  const lastProgressRef = useRef(progress)

  const updateFromPoint = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current || !onProgressChange) return
    const rect = svgRef.current.getBoundingClientRect()
    const dx = clientX - (rect.left + rect.width / 2)
    const dy = clientY - (rect.top + rect.height / 2)
    let angle = Math.atan2(dx, -dy)
    if (angle < 0) angle += 2 * Math.PI
    const raw = angle / (2 * Math.PI)
    const snapped = Math.max(1 / 60, Math.min(1, Math.round(raw * 60) / 60))
    // Haptic feedback when value changes
    if (snapped !== lastProgressRef.current && navigator.vibrate) {
      navigator.vibrate(1)
    }
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
        {ticks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1} y1={tick.y1}
            x2={tick.x2} y2={tick.y2}
            stroke={tick.isMajor ? majorTickColor : minorTickColor}
            strokeWidth={tick.isMajor ? 2 : 1}
            strokeLinecap="round"
          />
        ))}

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
