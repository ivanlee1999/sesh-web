'use client'

/**
 * The icon set: lucide, drawn with round caps at a 1.8 stroke.
 *
 * The rest of the system has soft corners and hairlines, and a square-capped
 * icon next to a 10px-radius button reads as borrowed. Wrapping them once here
 * keeps the cap and the weight from being a per-call-site decision.
 */

import {
  ArrowRight,
  BarChart3,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  Pause,
  Play,
  RotateCw,
  Settings,
  Timer,
  X,
  type LucideIcon,
} from 'lucide-react'

export const MD_ICONS = {
  focus: Timer,
  tasks: List,
  calendar: Calendar,
  insights: BarChart3,
  settings: Settings,
  play: Play,
  pause: Pause,
  check: Check,
  close: X,
  arrow: ArrowRight,
  prev: ChevronLeft,
  next: ChevronRight,
  refresh: RotateCw,
} satisfies Record<string, LucideIcon>

export type MdIconName = keyof typeof MD_ICONS

export function MdIcon({
  name,
  size = 17,
  strokeWidth = 1.8,
  color,
  className,
  style,
}: {
  name: MdIconName
  size?: number
  strokeWidth?: number
  color?: string
  className?: string
  style?: React.CSSProperties
}) {
  const Glyph = MD_ICONS[name]
  return (
    <Glyph
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      color={color}
      className={className}
      style={{ flex: 'none', display: 'block', ...style }}
      aria-hidden="true"
    />
  )
}
