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
})
