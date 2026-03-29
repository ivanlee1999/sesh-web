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
    const queue = getSessionQueue()
    if (queue.length === 0) return

    // Process from oldest to newest. Remove each as it succeeds.
    for (let i = 0; i < queue.length; i++) {
      const session = queue[i]
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session),
        })
        if (res.ok) {
          removeQueuedSession(i)
          i-- // array shifted
        }
      } catch {
        // Still offline or server error — stop trying
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
