'use client'
import { useState, useEffect, useCallback } from 'react'
import { getSessionQueue, removeQueuedSession } from '@/lib/local-store'

/**
 * Tracks browser online/offline status.
 * On reconnect, flushes any queued offline sessions to the server.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  const flushQueue = useCallback(async () => {
    // Re-read the queue on every iteration to avoid stale-index drift
    // after a successful removal.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const queue = getSessionQueue()
      if (queue.length === 0) break

      const session = queue[0]
      // Normalize: ensure `type` is set (legacy entries may only have `sessionType`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legacy = session as any
      const payload = {
        ...session,
        type: session.type || legacy.sessionType || 'focus',
      }
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          removeQueuedSession(0)
        } else {
          // Server rejected — stop trying
          break
        }
      } catch {
        // Still offline or network error — stop trying
        break
      }
    }
  }, [])

  useEffect(() => {
    const goOnline = () => {
      setOnline(true)
      flushQueue()
    }
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [flushQueue])

  return online
}
