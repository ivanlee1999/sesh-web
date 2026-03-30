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
      try {
        // Replay as a timer completion (POST /api/timer) so the server
        // atomically resets timer_state and inserts the session with
        // compare-and-swap on startedAt. This prevents duplicates if
        // another client already completed the same timer.
        const res = await fetch('/api/timer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startedAt: session.startedAt,
            intention: session.intention,
            category: session.category,
            notes: session.notes ?? '',
          }),
        })
        if (res.ok) {
          removeQueuedSession(0)
        } else if (res.status >= 400 && res.status < 500) {
          // Client error (e.g. timer already completed) — discard and move on
          removeQueuedSession(0)
        } else {
          // Server error — stop trying, will retry on next reconnect
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
