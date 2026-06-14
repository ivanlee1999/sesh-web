import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScreenWakeLock } from '../useScreenWakeLock'

function setVisible() {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
}

function installWakeLockMock() {
  const release = vi.fn(async () => {})
  const sentinel = new EventTarget() as EventTarget & {
    released: boolean
    type: 'screen'
    release: () => Promise<void>
  }
  sentinel.released = false
  sentinel.type = 'screen'
  sentinel.release = release
  const request = vi.fn(async () => sentinel)

  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  })

  return { request, release, sentinel }
}

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: undefined,
  })
})

describe('useScreenWakeLock', () => {
  it('can request immediately from a start-button gesture before active state has re-rendered', async () => {
    setVisible()
    const wakeLock = installWakeLockMock()
    const { result } = renderHook(() => useScreenWakeLock(false))

    await act(async () => {
      await result.current.request({ allowWhileInactive: true })
    })

    expect(wakeLock.request).toHaveBeenCalledWith('screen')
    expect(wakeLock.release).not.toHaveBeenCalled()
    expect(result.current.status).toBe('on')
  })

  it('releases the held wake lock when active becomes false', async () => {
    setVisible()
    const wakeLock = installWakeLockMock()
    const { rerender } = renderHook(({ active }) => useScreenWakeLock(active), {
      initialProps: { active: true },
    })

    await waitFor(() => expect(wakeLock.request).toHaveBeenCalledWith('screen'))

    rerender({ active: false })

    await waitFor(() => expect(wakeLock.release).toHaveBeenCalled())
  })
})
