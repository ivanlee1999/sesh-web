import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProgressRing from '../ProgressRing'

describe('ProgressRing', () => {
  const defaultProps = {
    progress: 0.5,
    color: '#3b82f6',
    size: 300,
  }

  it('renders without crashing at progress=0', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders without crashing at progress=0.5', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders without crashing at progress=1', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={1} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders 60 tick marks (48 minor + 12 major, all as <line> elements)', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    expect(lines.length).toBe(60)
  })

  it('renders 12 major ticks with strokeWidth=2.5', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    const majorTicks = Array.from(lines).filter(
      l => l.getAttribute('stroke-width') === '2.5'
    )
    expect(majorTicks.length).toBe(12)
  })

  it('renders 48 minor ticks with strokeWidth=1.5', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    const minorTicks = Array.from(lines).filter(
      l => l.getAttribute('stroke-width') === '1.5'
    )
    expect(minorTicks.length).toBe(48)
  })

  it('uses high-contrast fixed colors for strokes', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    // Base circle should use #CCCCCC
    const baseCircle = container.querySelector('svg circle')!
    expect(baseCircle.getAttribute('stroke')).toBe('#CCCCCC')

    // Major ticks should use #000000
    const lines = container.querySelectorAll('svg line')
    const majorTick = Array.from(lines).find(l => l.getAttribute('stroke-width') === '2.5')!
    expect(majorTick.getAttribute('stroke')).toBe('#000000')

    // Minor ticks should use #666666
    const minorTick = Array.from(lines).find(l => l.getAttribute('stroke-width') === '1.5')!
    expect(minorTick.getAttribute('stroke')).toBe('#666666')
  })

  it('uses base circle strokeWidth=4', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const baseCircle = container.querySelector('svg circle')!
    expect(baseCircle.getAttribute('stroke-width')).toBe('4')
  })

  it('does not render wedge path when progress=0', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0} />)
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBe(0)
  })

  it('renders wedge path when progress > 0', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} />)
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBe(1)
    expect(paths[0].getAttribute('d')).toBeTruthy()
  })

  it('renders glow filter on progress arc in non-interactive mode', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} />)
    const circles = container.querySelectorAll('svg circle')
    // The progress arc circle should have filter="url(#ring-glow)"
    const progressArc = Array.from(circles).find(
      c => c.getAttribute('filter') === 'url(#ring-glow)'
    )
    expect(progressArc).toBeTruthy()
  })

  it('does not render glow filter when progress=0', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0} />)
    const circles = container.querySelectorAll('svg circle')
    const withGlow = Array.from(circles).find(
      c => c.getAttribute('filter') === 'url(#ring-glow)'
    )
    expect(withGlow).toBeFalsy()
  })

  it('does not render minute numbers in non-interactive mode', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const texts = container.querySelectorAll('svg text')
    expect(texts.length).toBe(0)
  })

  it('renders 12 minute numbers in interactive mode with correct styling', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} interactive />
    )
    const texts = container.querySelectorAll('svg text')
    expect(texts.length).toBe(12)
    // Check values: 5, 10, 15, ..., 60
    const values = Array.from(texts).map(t => t.textContent)
    expect(values).toEqual(['5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60'])

    // Check styling: black, size 12, weight 600
    const firstLabel = texts[0]
    expect(firstLabel.getAttribute('fill')).toBe('#000000')
    expect(firstLabel.getAttribute('font-size')).toBe('12')
    expect(firstLabel.getAttribute('font-weight')).toBe('600')
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
    const { container } = render(<ProgressRing {...defaultProps} />)
    const svg = container.querySelector('svg')!
    expect(svg.style.touchAction).toBe('')
  })

  it('renders tip border color as white', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} progress={0.5} interactive />
    )
    const circles = container.querySelectorAll('svg circle')
    // The tip dot should have white border
    const tipCircle = Array.from(circles).find(
      c => c.getAttribute('stroke') === '#FFFFFF'
    )
    expect(tipCircle).toBeTruthy()
  })

  it('uses progress arc strokeWidth of at least 10', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} />)
    const circles = container.querySelectorAll('svg circle')
    // Find the progress arc (the one with the color prop as stroke)
    const progressArc = Array.from(circles).find(
      c => c.getAttribute('stroke') === '#3b82f6'
    )
    expect(progressArc).toBeTruthy()
    const sw = Number(progressArc!.getAttribute('stroke-width'))
    expect(sw).toBeGreaterThanOrEqual(10)
  })
})
