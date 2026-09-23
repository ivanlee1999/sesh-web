import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRefreshWhileVisible } from '../useRefreshWhileVisible'

let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRefreshWhileVisible', () => {
  it('refreshes on the interval while visible, and not while hidden', () => {
    const refresh = vi.fn()
    renderHook(() => useRefreshWhileVisible(refresh, { intervalMs: 30_000 }))

    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    vi.advanceTimersByTime(90_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes once on coming back, even when focus and visibilitychange both fire', () => {
    const refresh = vi.fn()
    renderHook(() => useRefreshWhileVisible(refresh))

    vi.advanceTimersByTime(10_000)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing until enabled', () => {
    const refresh = vi.fn()
    renderHook(() => useRefreshWhileVisible(refresh, { enabled: false }))

    vi.advanceTimersByTime(120_000)
    window.dispatchEvent(new Event('focus'))
    expect(refresh).not.toHaveBeenCalled()
  })
})
