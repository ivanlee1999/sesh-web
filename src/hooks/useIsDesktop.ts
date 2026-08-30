'use client'

import { useEffect, useState } from 'react'

/**
 * Phone and desktop are different compositions, not one column at two widths:
 * the phone keeps a bottom tab bar and gets the task queue as a sheet, the
 * desktop gets a permanent nav rail and the queue beside the dial. That is a
 * structural difference, so it has to be a real value the components branch
 * on rather than a media query.
 *
 * Starts false so the server and the first client paint agree — the phone
 * layout is the safe default, and the switch lands on the same tick as the
 * first effect.
 */
export const DESKTOP_QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(DESKTOP_QUERY)
    const sync = () => setIsDesktop(mq.matches)
    sync()

    // Safari only grew addEventListener on MediaQueryList in 14, and a stubbed
    // matchMedia may expose neither. Read the value either way; subscribe only
    // if there is something to subscribe to.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync)
      return () => mq.removeEventListener('change', sync)
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(sync)
      return () => mq.removeListener(sync)
    }
  }, [])

  return isDesktop
}
