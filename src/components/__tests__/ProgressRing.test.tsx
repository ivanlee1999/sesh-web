import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProgressRing from '../ProgressRing'

// Mock useSettings to provide darkMode setting
const mockSettings = { darkMode: false }
vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: mockSettings,
    updateSettings: vi.fn(),
  }),
}))

describe('ProgressRing', () => {
  const defaultProps = {
    progress: 0.5,
    color: '#3b82f6',
    size: 300,
  }

  it('renders without crashing at progress=0', () => {
    render(<ProgressRing {...defaultProps} progress={0} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders without crashing at progress=0.5', () => {
    render(<ProgressRing {...defaultProps} progress={0.5} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders without crashing at progress=1', () => {
    render(<ProgressRing {...defaultProps} progress={1} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders 60 tick marks (48 minor + 12 major, all as <line> elements)', () => {
    render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    expect(lines.length).toBe(60)
  })

  it('renders 12 major ticks with strokeWidth=3', () => {
    render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    const majorTicks = Array.from(lines).filter(
      l => l.getAttribute('stroke-width') === '3'
    )
    expect(majorTicks.length).toBe(12)
  })

  it('renders 48 minor ticks with strokeWidth=1.5', () => {
    render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    const minorTicks = Array.from(lines).filter(
      l => l.getAttribute('stroke-width') === '1.5'
    )
    expect(minorTicks.length).toBe(48)
  })

  it('uses light-theme colors for strokes in light mode', () => {
    mockSettings.darkMode = false
    render(<ProgressRing {...defaultProps} />)
    // Base circle should use light-mode track color
    const baseCircle = container.querySelector('svg circle')!
    expect(baseCircle.getAttribute('stroke')).toBe('#999999')

    // Major ticks should use dark stroke in light mode
    const lines = container.querySelectorAll('svg line')
    const majorTick = Array.from(lines).find(l => l.getAttribute('stroke-width') === '3')!
    expect(majorTick.getAttribute('stroke')).toBe('#333333')
  })

  it('uses dark-theme colors for strokes in dark mode', () => {
    mockSettings.darkMode = true
    render(<ProgressRing {...defaultProps} />)
    // Base circle should use dark-mode track color
    const baseCircle = container.querySelector('svg circle')!
    expect(baseCircle.getAttribute('stroke')).toBe('#666666')

    // Major ticks should use lighter stroke in dark mode
    const lines = container.querySelectorAll('svg line')
    const majorTick = Array.from(lines).find(l => l.getAttribute('stroke-width') === '3')!
    expect(majorTick.getAttribute('stroke')).toBe('#cccccc')

    // Reset for other tests
    mockSettings.darkMode = false
  })

  it('does not render wedge path when progress=0', () => {
    render(<ProgressRing {...defaultProps} progress={0} />)
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBe(0)
  })

  it('renders wedge path when progress > 0', () => {
    render(<ProgressRing {...defaultProps} progress={0.5} />)
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBe(1)
    expect(paths[0].getAttribute('d')).toBeTruthy()
  })

  it('renders glow filter on progress arc in non-interactive mode', () => {
    render(<ProgressRing {...defaultProps} progress={0.5} />)
    const circles = container.querySelectorAll('svg circle')
    // The progress arc circle should have filter="url(#ring-glow)"
    const progressArc = Array.from(circles).find(
      c => c.getAttribute('filter') === 'url(#ring-glow)'
    )
    expect(progressArc).toBeTruthy()
  })

  it('does not render glow filter when progress=0', () => {
    render(<ProgressRing {...defaultProps} progress={0} />)
    const circles = container.querySelectorAll('svg circle')
    const withGlow = Array.from(circles).find(
      c => c.getAttribute('filter') === 'url(#ring-glow)'
    )
    expect(withGlow).toBeFalsy()
  })

  it('does not render minute numbers in non-interactive mode', () => {
    render(<ProgressRing {...defaultProps} />)
    const texts = container.querySelectorAll('svg text')
    expect(texts.length).toBe(0)
  })

  it('renders 12 minute numbers in interactive mode', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} interactive />
    )
    const texts = container.querySelectorAll('svg text')
    expect(texts.length).toBe(12)
    // Check values: 5, 10, 15, ..., 60
    const values = Array.from(texts).map(t => t.textContent)
    expect(values).toEqual(['5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60'])
  })

  it('renders clock hand elements in interactive mode with progress > 0', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} progress={0.5} interactive />
    )
    // Interactive mode with progress > 0: center dot + hand line + tip dot
    const circles = container.querySelectorAll('svg circle')
    // Base circle + progress arc + center dot + tip dot = 4
    expect(circles.length).toBeGreaterThanOrEqual(4)

    // Should have 60 tick lines + 1 hand line = 61 total lines
    const lines = container.querySelectorAll('svg line')
    expect(lines.length).toBe(61)
  })

  it('does not render clock hand in interactive mode when progress=0', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} progress={0} interactive />
    )
    // Only 60 tick lines, no hand line
    const lines = container.querySelectorAll('svg line')
    expect(lines.length).toBe(60)
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
    render(<ProgressRing {...defaultProps} />)
    const svg = container.querySelector('svg')!
    expect(svg.style.touchAction).toBe('')
  })

  it('uses theme-appropriate tip border color in dark mode', () => {
    mockSettings.darkMode = true
    render(
      <ProgressRing {...defaultProps} progress={0.5} interactive />
    )
    const circles = container.querySelectorAll('svg circle')
    // The tip dot should have dark background as its border
    const tipCircle = Array.from(circles).find(
      c => c.getAttribute('stroke') === '#1c1c1e'
    )
    expect(tipCircle).toBeTruthy()
    mockSettings.darkMode = false
  })
})
