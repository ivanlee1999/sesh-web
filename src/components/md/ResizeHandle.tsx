'use client'

/**
 * The draggable edge between two desktop panes.
 *
 * It *is* the 2px rule the design already puts there — the pane beside it
 * drops its own border and this takes over — so at rest the layout looks
 * exactly as drawn. Only the cursor, and a tint on hover or while dragging,
 * say that it moves. The grab area is widened either side with a pseudo
 * element rather than by drawing a thicker line.
 *
 * Keyboard reachable: arrow keys nudge the width, Home restores the designed
 * one, which is also what a double-click does.
 */
export default function ResizeHandle({
  label,
  width,
  min,
  max,
  dragging,
  towards,
  onStart,
  onNudge,
  onReset,
}: {
  label: string
  width: number
  min: number
  max: number
  dragging: boolean
  /** Which side the pane being sized is on. */
  towards: 'start' | 'end'
  onStart: (event: React.PointerEvent, towards: 'start' | 'end') => void
  onNudge: (delta: number) => void
  onReset: () => void
}) {
  const STEP = 16

  return (
    <div
      className="md-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-dragging={dragging ? 'true' : 'false'}
      onPointerDown={event => onStart(event, towards)}
      onDoubleClick={onReset}
      onKeyDown={event => {
        const grow = towards === 'start' ? 1 : -1
        if (event.key === 'ArrowLeft') { event.preventDefault(); onNudge(-STEP * grow) }
        if (event.key === 'ArrowRight') { event.preventDefault(); onNudge(STEP * grow) }
        if (event.key === 'Home') { event.preventDefault(); onReset() }
      }}
    />
  )
}
