'use client'
import { useEffect, useRef } from 'react'

/** Coming back to the app fires focus and visibilitychange together; one fetch is enough. */
const MIN_GAP_MS = 5_000

/**
 * Re-runs `refresh` whenever the person comes back to sesh, and every
 * `intervalMs` while they are looking at it.
 *
 * The task lists live in other apps: a to-do ticked off in Things.app says
 * nothing to sesh, so a list loaded once on mount stays wrong until a reload.
 * Neither Things Cloud nor Todoist pushes changes, so asking again is the only
 * way to hear about them — and the moments worth asking are the ones where
 * someone could see the answer. Nothing runs while the tab is hidden.
 *
 * The initial load is left to the caller, which usually has its own reasons to
 * wait (settings still loading, say).
 */
export function useRefreshWhileVisible(
  refresh: () => unknown,
  { intervalMs = 30_000, enabled = true }: { intervalMs?: number; enabled?: boolean } = {},
) {
  // Held in a ref so a caller's changing callback does not restart the interval.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    if (!enabled) return
    let last = Date.now()
    const run = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - last < MIN_GAP_MS) return
      last = Date.now()
      void refreshRef.current()
    }

    const timer = setInterval(run, intervalMs)
    document.addEventListener('visibilitychange', run)
    window.addEventListener('focus', run)
    window.addEventListener('online', run)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', run)
      window.removeEventListener('focus', run)
      window.removeEventListener('online', run)
    }
  }, [enabled, intervalMs])
}
