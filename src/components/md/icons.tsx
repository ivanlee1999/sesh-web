'use client'

/**
 * The icon set, as lucide with the system's square cap.
 *
 * Every icon in this design is drawn with `stroke-linecap: square` and a
 * heavier stroke than lucide's default — rounded caps are the one thing that
 * would make the whole set read as the old iOS language again. Wrapping them
 * once here keeps that from being a per-call-site decision.
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
  strokeWidth = 1.9,
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
      strokeLinecap="square"
      strokeLinejoin="miter"
      color={color}
      className={className}
      style={{ flex: 'none', display: 'block', ...style }}
      aria-hidden="true"
    />
  )
}
