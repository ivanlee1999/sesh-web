'use client'
import { useEffect, useRef, useState } from 'react'

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

  useEffect(() => {
    let cancelled = false

    const releaseWakeLock = async () => {
      const current = wakeLockRef.current
      wakeLockRef.current = null
      if (current && !current.released) {
        try {
          await current.release()
        } catch {
          // Ignore release failures; the browser may have already released it.
        }
      }
    }

    const requestWakeLock = async () => {
      const wakeLockApi = (navigator as WakeLockNavigator).wakeLock
      if (!wakeLockApi) {
        setStatus('unsupported')
        setError('Screen wake lock is not supported by this browser/iOS version.')
        return
      }

      if (wakeLockRef.current && !wakeLockRef.current.released) {
        setStatus('on')
        return
      }

      setStatus('requesting')
      setError(null)

      try {
        const sentinel = await wakeLockApi.request('screen')
        if (cancelled || !activeRef.current) {
          if (!sentinel.released) await sentinel.release()
          return
        }

        wakeLockRef.current = sentinel
        sentinel.addEventListener('release', () => {
          if (wakeLockRef.current === sentinel) {
            wakeLockRef.current = null
          }
          setStatus(activeRef.current ? 'released' : 'off')
        })
        setStatus('on')
      } catch (err) {
        wakeLockRef.current = null
        setStatus('blocked')
        setError(err instanceof Error ? err.message : 'The browser blocked screen wake lock.')
      }
    }

    const syncWakeLock = () => {
      if (!active) {
        setStatus(isScreenWakeLockSupported() ? 'off' : 'unsupported')
        setError(null)
        void releaseWakeLock()
        return
      }

      if (document.visibilityState === 'visible') {
        void requestWakeLock()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && activeRef.current) {
        void requestWakeLock()
      }
    }

    syncWakeLock()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void releaseWakeLock()
    }
  }, [active])

  return { supported: isScreenWakeLockSupported(), status, error }
}
