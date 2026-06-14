'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

type WakeLockSentinel = EventTarget & {
  released: boolean
  type: 'screen'
  release: () => Promise<void>
}

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinel>
  }
}

export type ScreenWakeLockStatus = 'unsupported' | 'off' | 'requesting' | 'on' | 'blocked' | 'released'

export function isScreenWakeLockSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  return Boolean((navigator as WakeLockNavigator).wakeLock)
}

export function useScreenWakeLock(active: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const activeRef = useRef(active)
  const [status, setStatus] = useState<ScreenWakeLockStatus>(() => (
    isScreenWakeLockSupported() ? 'off' : 'unsupported'
  ))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  const release = useCallback(async () => {
    const current = wakeLockRef.current
    wakeLockRef.current = null
    if (current && !current.released) {
      try {
        await current.release()
      } catch {
        // Ignore release failures; the browser may have already released it.
      }
    }
    if (!activeRef.current) {
      setStatus(isScreenWakeLockSupported() ? 'off' : 'unsupported')
      setError(null)
    }
  }, [])

  const request = useCallback(async (options?: { allowWhileInactive?: boolean }) => {
    const wakeLockApi = (navigator as WakeLockNavigator).wakeLock
    if (!wakeLockApi) {
      setStatus('unsupported')
      setError('Screen wake lock is not supported by this browser/iOS version.')
      return false
    }

    if (document.visibilityState !== 'visible') {
      setStatus('blocked')
      setError('Screen wake lock can only start while the app is visible.')
      return false
    }

    if (wakeLockRef.current && !wakeLockRef.current.released) {
      setStatus('on')
      return true
    }

    setStatus('requesting')
    setError(null)

    try {
      const sentinel = await wakeLockApi.request('screen')
      if (!activeRef.current && !options?.allowWhileInactive) {
        if (!sentinel.released) await sentinel.release()
        setStatus(isScreenWakeLockSupported() ? 'off' : 'unsupported')
        return false
      }

      wakeLockRef.current = sentinel
      sentinel.addEventListener('release', () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null
        }
        setStatus(activeRef.current ? 'released' : 'off')
      })
      setStatus('on')
      return true
    } catch (err) {
      wakeLockRef.current = null
      setStatus('blocked')
      setError(err instanceof Error ? err.message : 'The browser blocked screen wake lock.')
      return false
    }
  }, [])

  useEffect(() => {
    if (!active) {
      void release()
      return
    }

    if (document.visibilityState === 'visible') {
      void request()
    }
  }, [active, release, request])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && activeRef.current) {
        void request()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [request])

  useEffect(() => {
    return () => {
      void release()
    }
  }, [release])

  return { supported: isScreenWakeLockSupported(), status, error, request, release }
}
