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

  it('renders 60 tick marks', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    expect(lines.length).toBe(60)
  })

  it('renders 12 major ticks with strokeWidth=3', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    const majorTicks = Array.from(lines).filter(
      l => l.getAttribute('stroke-width') === '3'
    )
    expect(majorTicks.length).toBe(12)
  })

  it('renders 48 minor ticks with strokeWidth=2', () => {
    const { container } = render(<ProgressRing {...defaultProps} />)
    const lines = container.querySelectorAll('svg line')
    const minorTicks = Array.from(lines).filter(
      l => l.getAttribute('stroke-width') === '2'
    )
    expect(minorTicks.length).toBe(48)
  })

  it('uses light-mode colors when darkMode=false', () => {
    mockDarkMode = false
    const { container } = render(<ProgressRing {...defaultProps} />)
    const baseCircle = container.querySelector('svg circle')!
    expect(baseCircle.getAttribute('stroke')).toBe('#CCCCCC')

    const lines = container.querySelectorAll('svg line')
    const majorTick = Array.from(lines).find(l => l.getAttribute('stroke-width') === '3')!
    expect(majorTick.getAttribute('stroke')).toBe('#000000')

    const minorTick = Array.from(lines).find(l => l.getAttribute('stroke-width') === '2')!
    expect(minorTick.getAttribute('stroke')).toBe('#666666')
  })

  it('uses dark-mode colors when darkMode=true', () => {
    mockDarkMode = true
    const { container } = render(<ProgressRing {...defaultProps} />)
    const baseCircle = container.querySelector('svg circle')!
    expect(baseCircle.getAttribute('stroke')).toBe('#555555')

    const lines = container.querySelectorAll('svg line')
    const majorTick = Array.from(lines).find(l => l.getAttribute('stroke-width') === '3')!
    expect(majorTick.getAttribute('stroke')).toBe('#FFFFFF')

    const minorTick = Array.from(lines).find(l => l.getAttribute('stroke-width') === '2')!
    expect(minorTick.getAttribute('stroke')).toBe('#AAAAAA')
    mockDarkMode = false
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

  it('renders 12 minute numbers with correct values', () => {
    mockDarkMode = false
    const { container } = render(
      <ProgressRing {...defaultProps} interactive />
    )
    const texts = container.querySelectorAll('svg text')
    expect(texts.length).toBe(12)
    const values = Array.from(texts).map(t => t.textContent)
    expect(values).toEqual(['5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60'])
  })

  it('renders clock hand in interactive mode with progress > 0', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} progress={0.5} interactive />
    )
    // Should have 60 tick lines + 1 hand line = 61 total lines
    const lines = container.querySelectorAll('svg line')
    expect(lines.length).toBe(61)
  })

  it('does not render clock hand in interactive mode when progress=0', () => {
    const { container } = render(
      <ProgressRing {...defaultProps} progress={0} interactive />
    )
    const lines = container.querySelectorAll('svg line')
    expect(lines.length).toBe(60)
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

  it('uses progress arc strokeWidth of at least 10', () => {
    const { container } = render(<ProgressRing {...defaultProps} progress={0.5} />)
    const circles = container.querySelectorAll('svg circle')
    const progressArc = Array.from(circles).find(
      c => c.getAttribute('stroke') === '#3b82f6'
    )
    expect(progressArc).toBeTruthy()
    const sw = Number(progressArc!.getAttribute('stroke-width'))
    expect(sw).toBeGreaterThanOrEqual(10)
  })

  it('renders tip border color as white in light mode', () => {
    mockDarkMode = false
    const { container } = render(
      <ProgressRing {...defaultProps} progress={0.5} interactive />
    )
    const circles = container.querySelectorAll('svg circle')
    const tipCircle = Array.from(circles).find(
      c => c.getAttribute('stroke') === '#FFFFFF'
    )
    expect(tipCircle).toBeTruthy()
  })
})
