import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let mockDarkMode = false
let mockSoundEnabled = false

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: { darkMode: mockDarkMode, soundEnabled: mockSoundEnabled },
    updateSettings: vi.fn(),
  }),
}))

import ProgressRing from '../ProgressRing'

// Helper: compute clientX/clientY for a given minute on the ring
// Ring center is at (size/2, size/2) relative to viewport; minute 0/60 = top (12 o'clock)
function pointForMinute(minute: number, size: number, rect: DOMRect) {
  const angle = (minute / 60) * 2 * Math.PI - Math.PI / 2
  const r = 80 // approximate radius for pointer, doesn't need to be exact
  return {
    clientX: rect.left + size / 2 + r * Math.cos(angle),
    clientY: rect.top + size / 2 + r * Math.sin(angle),
  }
}

describe('ProgressRing', () => {
  const defaultProps = {
    progress: 0.5,
    color: '#3b82f6',
    size: 240,
  }

  beforeEach(() => {
    mockDarkMode = false
    mockSoundEnabled = false
  })

  it('renders without crashing at progress=0', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders without crashing at progress=0.5', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} interactive />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders without crashing at progress=1', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={1} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders 60 tick marks (12 major, 48 minor)', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    expect(lines.length).toBe(60)
    const texts = container.querySelectorAll('svg text')
    // No minute number labels (clean design)
    expect(texts.length).toBe(0)
  })

  it('renders a base track circle with correct light mode color', () => {
    mockDarkMode = false
    const { container } = render(<ProgressRing {...defaultProps} />)
    const circles = container.querySelectorAll('svg circle')
    const track = circles[0]
    expect(track).toBeTruthy()
    expect(track.getAttribute('stroke')).toBe('#F0F0F0')
    expect(track.getAttribute('stroke-width')).toBe('14')
  })

  it('renders a base track circle with correct dark mode color', () => {
    mockDarkMode = true
    const { container } = render(<ProgressRing {...defaultProps} />)
    const circles = container.querySelectorAll('svg circle')
    const track = circles[0]
    expect(track).toBeTruthy()
    expect(track.getAttribute('stroke')).toBe('#2C2C2E')
    mockDarkMode = false
  })

  it('renders a progress arc with the category color', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} interactive />)
    const circles = container.querySelectorAll('svg circle')
    const progressArc = Array.from(circles).find(
      c => c.getAttribute('stroke') === '#3b82f6' && c.getAttribute('stroke-width') === '14'
    )
    expect(progressArc).toBeTruthy()
    expect(progressArc!.getAttribute('stroke-linecap')).toBe('round')
    expect(progressArc!.getAttribute('stroke-width')).toBe('14')
  })

  it('does not render wedge path when progress=0', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0} />)
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBe(0)
  })

  it('renders wedge path when progress > 0', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} interactive />)
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBe(1)
    expect(paths[0].getAttribute('d')).toBeTruthy()
  })

  it('renders a tip dot at arc end when progress > 0', () => {
    mockDarkMode = false
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} interactive />)
    const circles = container.querySelectorAll('svg circle')
    // Should have: track circle, progress arc circle, tip dot circle = 3
    const tipDot = Array.from(circles).find(
      c => c.getAttribute('r') === '9' && c.getAttribute('fill') === '#3b82f6'
    )
    expect(tipDot).toBeTruthy()
    expect(tipDot!.getAttribute('stroke')).toBe('#FFFFFF')
  })

  it('does not render tip dot when progress=0', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0} />)
    const circles = container.querySelectorAll('svg circle')
    // Only track + progress arc = 2 circles
    // No tip dot, just track + arc circles
    const tipDot = Array.from(circles).find(c => c.getAttribute('r') === '9')
    expect(tipDot).toBeFalsy()
  })

  it('creates unique gradient ids across multiple instances', () => {
    const { container } = render(
      <div>
        <ProgressRing {...defaultProps} progress={0.5} />
        <ProgressRing {...defaultProps} progress={0.5} />
      </div>
    )
    const gradients = container.querySelectorAll('radialGradient')
    expect(gradients.length).toBe(2)
    const ids = Array.from(gradients).map(g => g.id)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('renders children in the overlay div', () => {
    render(
      <ProgressRing {...defaultProps}>
        <span data-testid="child">25:00</span>
      </ProgressRing>
    )
    expect(screen.getByTestId('child')).toHaveTextContent('25:00')
  })

  it('sets touch-action:none and cursor:pointer in interactive mode', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} interactive />
    )
    const svg = container.querySelector('svg')!
    expect(svg.style.touchAction).toBe('none')
    expect(svg.style.cursor).toBe('pointer')
  })

  it('does not set interactive styles in non-interactive mode', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const svg = container.querySelector('svg')!
    expect(svg.style.touchAction).toBe('')
  })

  it('tip dot has dark mode border color', () => {
    mockDarkMode = true
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} interactive />)
    const circles = container.querySelectorAll('svg circle')
    const tipDot = Array.from(circles).find(
      c => c.getAttribute('r') === '9' && c.getAttribute('fill') === '#3b82f6'
    )
    expect(tipDot).toBeTruthy()
    expect(tipDot!.getAttribute('stroke')).toBe('#1c1c1e')
    mockDarkMode = false
  })

  it('does not render hidden switch hack elements', () => {
    const { container } = render(<ProgressRing {...defaultProps} interactive />)
    const checkbox = container.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeNull()
    const label = container.querySelector('label')
    expect(label).toBeNull()
  })

  // --- Visual emphasis tests ---

  it('highlights the active major tick when progress is exactly a multiple of 5', () => {
    // progress = 25/60 = 25 minutes (multiple of 5)
    const { container } = render(
      <ProgressRing {...defaultProps} progress={25 / 60} interactive />
    )
    const activeMajorLines = container.querySelectorAll('line[data-active-major="true"]')
    expect(activeMajorLines.length).toBe(1)
    expect(activeMajorLines[0].getAttribute('stroke')).toBe('#3b82f6')
    expect(activeMajorLines[0].getAttribute('stroke-width')).toBe('3')
  })

  it('does not highlight any major tick when progress is not a multiple of 5', () => {
    // progress = 23/60 = 23 minutes (not a multiple of 5)
    const { container } = render(
      <ProgressRing {...defaultProps} progress={23 / 60} interactive />
    )
    const activeMajorLines = container.querySelectorAll('line[data-active-major="true"]')
    expect(activeMajorLines.length).toBe(0)
  })

  it('does not highlight ticks in non-interactive mode even at multiple of 5', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} progress={25 / 60} interactive={false} />
    )
    const activeMajorLines = container.querySelectorAll('line[data-active-major="true"]')
    expect(activeMajorLines.length).toBe(0)
  })

  it('highlights tick for 60 minutes (progress=1)', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} progress={1} interactive />
    )
    const activeMajorLines = container.querySelectorAll('line[data-active-major="true"]')
    expect(activeMajorLines.length).toBe(1)
  })

  // --- Drag / detent behavior tests ---

  describe('magnetic detent snapping', () => {
    let vibrateSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      vibrateSpy = vi.fn(() => true)
      Object.defineProperty(navigator, 'vibrate', {
        value: vibrateSpy,
        writable: true,
        configurable: true,
      })
    })

    afterEach(() => {
      Object.defineProperty(navigator, 'vibrate', {
        value: undefined,
        writable: true,
        configurable: true,
      })
    })

    function setupDrag() {
      const onProgressChange = vi.fn()
      const onDragEnd = vi.fn()
      const { container } = render(
        <ProgressRing
          {...defaultProps}
          progress={25 / 60}
          interactive
          onProgressChange={onProgressChange}
          onDragEnd={onDragEnd}
        />
      )
      const svg = container.querySelector('svg')!
      // Mock getBoundingClientRect
      vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, right: 240, bottom: 240,
        width: 240, height: 240, x: 0, y: 0, toJSON: () => {},
      })
      return { svg, onProgressChange, onDragEnd, container }
    }

    it('emits snapped progress on drag', () => {
      const { svg, onProgressChange } = setupDrag()
      const rect = svg.getBoundingClientRect()

      // Start drag
      fireEvent.mouseDown(svg, { clientX: rect.left + 120, clientY: rect.top + 10 })
      expect(onProgressChange).toHaveBeenCalled()

      const emitted = onProgressChange.mock.calls[0][0]
      // Should be a clean minute fraction
      const minute = Math.round(emitted * 60)
      expect(minute).toBeGreaterThanOrEqual(1)
      expect(minute).toBeLessThanOrEqual(60)
      expect(emitted).toBeCloseTo(minute / 60, 5)
    })

    it('locks to a multiple-of-5 within the capture band', () => {
      const { svg, onProgressChange } = setupDrag()
      const rect = svg.getBoundingClientRect()

      // Drag near 25 minutes (slightly off — 24.5 min angle)
      const pt = pointForMinute(24.5, 240, rect)
      fireEvent.mouseDown(svg, { clientX: pt.clientX, clientY: pt.clientY })

      const emitted = onProgressChange.mock.calls[0][0]
      const minute = Math.round(emitted * 60)
      // Should snap to 25 (nearest multiple of 5 within 1.5 min band)
      expect(minute).toBe(25)
    })

    it('stays locked at detent until raw movement exceeds release band', () => {
      const { svg, onProgressChange } = setupDrag()
      const rect = svg.getBoundingClientRect()

      // First, drag to exactly 25 min to lock
      const pt25 = pointForMinute(25, 240, rect)
      fireEvent.mouseDown(svg, { clientX: pt25.clientX, clientY: pt25.clientY })
      expect(Math.round(onProgressChange.mock.calls[0][0] * 60)).toBe(25)

      // Move slightly to 26 — still within ±2 release band, should stay at 25
      const pt26 = pointForMinute(26, 240, rect)
      fireEvent.mouseMove(window, { clientX: pt26.clientX, clientY: pt26.clientY })

      const lastCall = onProgressChange.mock.calls[onProgressChange.mock.calls.length - 1][0]
      expect(Math.round(lastCall * 60)).toBe(25)
    })

    it('calls navigator.vibrate on minute change', () => {
      const { svg } = setupDrag()
      const rect = svg.getBoundingClientRect()

      const pt10 = pointForMinute(10, 240, rect)
      fireEvent.mouseDown(svg, { clientX: pt10.clientX, clientY: pt10.clientY })

      expect(vibrateSpy).toHaveBeenCalled()
    })

    it('does not emit duplicate feedback for same minute', () => {
      const { svg } = setupDrag()
      const rect = svg.getBoundingClientRect()

      const pt15 = pointForMinute(15, 240, rect)
      fireEvent.mouseDown(svg, { clientX: pt15.clientX, clientY: pt15.clientY })
      const callCountAfterDown = vibrateSpy.mock.calls.length

      // Move to same position again
      fireEvent.mouseMove(window, { clientX: pt15.clientX, clientY: pt15.clientY })
      // Should not have additional vibrate calls since minute didn't change
      expect(vibrateSpy.mock.calls.length).toBe(callCountAfterDown)
    })
  })
})
