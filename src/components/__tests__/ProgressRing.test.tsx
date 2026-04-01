import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let mockDarkMode = false

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: { darkMode: mockDarkMode },
    updateSettings: vi.fn(),
  }),
}))

import ProgressRing from '../ProgressRing'

describe('ProgressRing', () => {
  const defaultProps = {
    progress: 0.5,
    color: '#3b82f6',
    size: 240,
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

  it('renders no tick marks or minute numbers', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    expect(lines.length).toBe(0)
    const texts = container.querySelectorAll('svg text')
    expect(texts.length).toBe(0)
  })

  it('renders a base track circle with correct light mode color', () => {
    mockDarkMode = false
    const { container } = render(<ProgressRing {...defaultProps} />)
    const circles = container.querySelectorAll('svg circle')
    const track = circles[0]
    expect(track).toBeTruthy()
    expect(track.getAttribute('stroke')).toBe('#E5E5EA')
    expect(track.getAttribute('stroke-width')).toBe('8')
  })

  it('renders a base track circle with correct dark mode color', () => {
    mockDarkMode = true
    const { container } = render(<ProgressRing {...defaultProps} />)
    const circles = container.querySelectorAll('svg circle')
    const track = circles[0]
    expect(track).toBeTruthy()
    expect(track.getAttribute('stroke')).toBe('#3A3A3C')
    mockDarkMode = false
  })

  it('renders a progress arc with the category color', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} />)
    const circles = container.querySelectorAll('svg circle')
    const progressArc = Array.from(circles).find(
      c => c.getAttribute('stroke') === '#3b82f6'
    )
    expect(progressArc).toBeTruthy()
    expect(progressArc!.getAttribute('stroke-linecap')).toBe('round')
    expect(progressArc!.getAttribute('stroke-width')).toBe('8')
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

  it('renders a tip dot at arc end when progress > 0', () => {
    mockDarkMode = false
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} />)
    const circles = container.querySelectorAll('svg circle')
    // Should have: track circle, progress arc circle, tip dot circle = 3
    const tipDot = Array.from(circles).find(
      c => c.getAttribute('r') === '6' && c.getAttribute('fill') === '#3b82f6'
    )
    expect(tipDot).toBeTruthy()
    expect(tipDot!.getAttribute('stroke')).toBe('#FFFFFF')
  })

  it('does not render tip dot when progress=0', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0} />)
    const circles = container.querySelectorAll('svg circle')
    // Only track + progress arc = 2 circles
    expect(circles.length).toBe(2)
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
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} />)
    const circles = container.querySelectorAll('svg circle')
    const tipDot = Array.from(circles).find(
      c => c.getAttribute('r') === '6' && c.getAttribute('fill') === '#3b82f6'
    )
    expect(tipDot).toBeTruthy()
    expect(tipDot!.getAttribute('stroke')).toBe('#1c1c1e')
    mockDarkMode = false
  })
})
