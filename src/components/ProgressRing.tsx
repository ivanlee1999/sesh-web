'use client'

import { useRef, useCallback, useEffect, useMemo, useId } from 'react'
import { useSettings } from '@/context/SettingsContext'

interface ProgressRingProps {
  progress: number  // 0-1
  color: string
  size: number
  strokeWidth?: number  // default 8
  children?: React.ReactNode
  interactive?: boolean
  onProgressChange?: (progress: number) => void
  onDragEnd?: (progress: number) => void
}

export default function ProgressRing({
  progress,
  color,
  size,
  strokeWidth = 8,
  children,
  interactive = false,
  onProgressChange,
  onDragEnd,
}: ProgressRingProps) {
  const { settings } = useSettings()
  const isDark = settings.darkMode
  const gradientId = useId()

  // Theme-aware colors
  const baseStroke = isDark ? '#555555' : '#CCCCCC'
  const majorTickColor = isDark ? '#FFFFFF' : '#000000'
  const minorTickColor = isDark ? '#AAAAAA' : '#666666'
  const minuteLabelColor = isDark ? '#FFFFFF' : '#000000'
  const tipBorderColor = isDark ? '#1c1c1e' : '#FFFFFF'

  const radius = (size - 44) / 2  // leave room for numbers outside
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

  // --- Tick marks ---
  const ticks = useMemo(() => Array.from({ length: 60 }, (_, i) => {
    const angle = fractionToAngle(i / 60)
    const isMajor = i % 5 === 0
    const outerR = radius + 2
    const innerR = isMajor ? radius - 12 : radius - 6
    return {
      x1: cx + innerR * Math.cos(angle),
      y1: cy + innerR * Math.sin(angle),
      x2: cx + outerR * Math.cos(angle),
      y2: cy + outerR * Math.sin(angle),
      isMajor,
    }
  }), [radius, cx, cy])

  // --- Minute numbers ---
  const minuteNumbers = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const minute = (i + 1) * 5
    const angle = fractionToAngle(minute / 60)
    const r = radius + 20
    return { minute, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  }), [radius, cx, cy])

  // --- Filled wedge path ---
  const clampedProgress = Math.min(Math.max(progress, 0), 1)
  const wedgePath = useMemo(() => {
    if (clampedProgress <= 0) return ''
    const startAngle = -Math.PI / 2
    const endAngle = startAngle + clampedProgress * 2 * Math.PI
    const startX = cx + radius * Math.cos(startAngle)
    const startY = cy + radius * Math.sin(startAngle)
    const endX = cx + radius * Math.cos(endAngle)
    const endY = cy + radius * Math.sin(endAngle)
    const largeArc = clampedProgress > 0.5 ? 1 : 0
    if (clampedProgress >= 1) {
      const midX = cx + radius * Math.cos(startAngle + Math.PI)
      const midY = cy + radius * Math.sin(startAngle + Math.PI)
      return `M ${cx},${cy} L ${startX},${startY} A ${radius},${radius} 0 0,1 ${midX},${midY} A ${radius},${radius} 0 0,1 ${startX},${startY} Z`
    }
    return `M ${cx},${cy} L ${startX},${startY} A ${radius},${radius} 0 ${largeArc},1 ${endX},${endY} Z`
  }, [clampedProgress, cx, cy, radius])

  // --- Clock hand ---
  const thumbAngle = fractionToAngle(progress)
  const handLen = radius - 14
  const handEndX = cx + handLen * Math.cos(thumbAngle)
  const handEndY = cy + handLen * Math.sin(thumbAngle)
  const tipX = cx + (radius - 4) * Math.cos(thumbAngle)
  const tipY = cy + (radius - 4) * Math.sin(thumbAngle)

  const wedgeGradientId = `${gradientId}-wedge`

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
          <radialGradient id={wedgeGradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="60%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0.45" />
          </radialGradient>
        </defs>

        {/* Base circle track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={baseStroke}
          strokeWidth={6}
        />

        {/* Tick marks */}
        {ticks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1} y1={tick.y1}
            x2={tick.x2} y2={tick.y2}
            stroke={tick.isMajor ? majorTickColor : minorTickColor}
            strokeWidth={tick.isMajor ? 3 : 2}
            strokeLinecap="round"
          />
        ))}

        {/* Filled wedge */}
        {clampedProgress > 0 && (
          <path
            d={wedgePath}
            fill={`url(#${wedgeGradientId})`}
            style={{ transition: interactive ? 'none' : 'd 0.3s ease' }}
          />
        )}

        {/* Progress arc stroke */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={Math.max(strokeWidth, 10)}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{
            transition: interactive ? 'none' : 'stroke-dashoffset 0.5s ease',
          }}
        />

        {/* Minute numbers */}
        {minuteNumbers.map(({ minute, x, y }) => (
          <text
            key={minute}
            x={x} y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fill={minuteLabelColor}
            fontSize={14}
            fontWeight={700}
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {minute}
          </text>
        ))}

        {/* Clock hand (interactive only) */}
        {interactive && clampedProgress > 0 && (
          <>
            <circle cx={cx} cy={cy} r={5} fill={color} />
            <line
              x1={cx} y1={cy}
              x2={handEndX} y2={handEndY}
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle
              cx={tipX} cy={tipY}
              r={5}
              fill={color}
              stroke={tipBorderColor}
              strokeWidth={3}
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
