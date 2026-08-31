import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePaneWidth } from '../usePaneWidth'
import { loadPaneLayout, savePaneWidth } from '@/lib/local-store'

const BOUNDS = { min: 168, max: 340, fallback: 214 }

/** A pointerdown/move/up on the window, as the handle produces. */
function drag(startDrag: (e: React.PointerEvent, t: 'start' | 'end') => void, from: number, to: number, towards: 'start' | 'end' = 'start') {
  act(() => {
    startDrag({ clientX: from, preventDefault: () => {} } as unknown as React.PointerEvent, towards)
  })
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: to }) as unknown as PointerEvent)
  })
  act(() => {
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: to }) as unknown as PointerEvent)
  })
}

beforeEach(() => {
  localStorage.clear()
  // Wide enough that the 40%-of-window ceiling is not what is under test.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
})

describe('usePaneWidth', () => {
  it('starts at the designed width, so an untouched layout is the handoff one', () => {
    const { result } = renderHook(() => usePaneWidth('rail', BOUNDS))
    expect(result.current.width).toBe(214)
  })

  it('widens a left-hand pane as the pointer moves right, and remembers it', () => {
    const { result } = renderHook(() => usePaneWidth('rail', BOUNDS))

    drag(result.current.startDrag, 300, 360)

    expect(result.current.width).toBe(274)
    expect(loadPaneLayout().rail).toBe(274)
  })

  it('widens a right-hand pane as the pointer moves left', () => {
    // The queue sits to the right of its handle, so it grows the other way.
    const { result } = renderHook(() => usePaneWidth('queue', { min: 248, max: 520, fallback: 326 }))

    drag(result.current.startDrag, 900, 840, 'end')

    expect(result.current.width).toBe(386)
  })

  it('will not let a pane be dragged past its bounds', () => {
    const { result } = renderHook(() => usePaneWidth('rail', BOUNDS))

    drag(result.current.startDrag, 300, -5000)
    expect(result.current.width).toBe(BOUNDS.min)

    drag(result.current.startDrag, 300, 5000)
    expect(result.current.width).toBe(BOUNDS.max)
  })

  it('restores a remembered width on mount', () => {
    savePaneWidth('rail', 250)
    const { result } = renderHook(() => usePaneWidth('rail', BOUNDS))
    expect(result.current.width).toBe(250)
  })

  it('clamps a remembered width that no longer fits the window', () => {
    // A layout saved on a big monitor must not strand the pane on a laptop.
    savePaneWidth('rail', 340)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })

    const { result } = renderHook(() => usePaneWidth('rail', BOUNDS))
    // 40% of 700 is 280, so that is as wide as it may be here.
    expect(result.current.width).toBe(280)
  })

  it('ignores a stored value that is not a usable number', () => {
    localStorage.setItem('sesh:paneLayout', JSON.stringify({ rail: 'wide', queue: -10 }))
    const { result } = renderHook(() => usePaneWidth('rail', BOUNDS))
    expect(result.current.width).toBe(BOUNDS.fallback)
  })

  it('forgets the width on reset, rather than storing the default', () => {
    savePaneWidth('rail', 300)
    const { result } = renderHook(() => usePaneWidth('rail', BOUNDS))
    expect(result.current.width).toBe(300)

    act(() => { result.current.reset() })

    expect(result.current.width).toBe(BOUNDS.fallback)
    // Cleared, not pinned: a later change to the designed width should apply.
    expect(loadPaneLayout().rail).toBeUndefined()
  })

  it('nudges by keyboard and remembers that too', () => {
    const { result } = renderHook(() => usePaneWidth('rail', BOUNDS))

    act(() => { result.current.nudge(16) })

    expect(result.current.width).toBe(230)
    expect(loadPaneLayout().rail).toBe(230)
  })

  it('keeps each pane width separate', () => {
    const rail = renderHook(() => usePaneWidth('rail', BOUNDS))
    const queue = renderHook(() => usePaneWidth('queue', { min: 248, max: 520, fallback: 326 }))

    act(() => { rail.result.current.nudge(16) })

    expect(loadPaneLayout()).toEqual({ rail: 230 })
    expect(queue.result.current.width).toBe(326)
  })

  it('clears the document drag guard when the pointer is released', () => {
    const { result } = renderHook(() => usePaneWidth('rail', BOUNDS))

    act(() => {
      result.current.startDrag({ clientX: 300, preventDefault: () => {} } as unknown as React.PointerEvent, 'start')
    })
    expect(document.documentElement.dataset.resizing).toBe('true')

    act(() => { window.dispatchEvent(new MouseEvent('pointerup', { clientX: 320 }) as unknown as PointerEvent) })
    expect(document.documentElement.dataset.resizing).toBeUndefined()
  })
})
