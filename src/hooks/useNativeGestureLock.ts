'use client'

import { useEffect } from 'react'

/**
 * Makes the page behave like an installed app rather than a web page.
 *
 * iOS Safari has ignored `user-scalable=no` since iOS 10, so pinch-zoom has to
 * be cancelled at the event level; double-tap zoom is handled by
 * `touch-action: manipulation` in globals.css. Anything that genuinely needs
 * to scroll opts in via a scroll container, which still works because we only
 * cancel multi-touch moves and drags that no scroller claimed.
 */
export function useNativeGestureLock() {
  useEffect(() => {
    const cancel = (event: Event) => event.preventDefault()

    const onTouchMove = (event: TouchEvent) => {
      // Pinch. Single-finger drags fall through to real scrollers.
      if (event.touches.length > 1) event.preventDefault()
    }

    // iOS nudges the window to reveal a focused field and does not always put
    // it back; left alone the whole shell stays offset. Only after the field
    // is done with it — resetting while the keyboard opens would undo the
    // pan that makes the field visible in the first place.
    const resetScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
    }

    document.addEventListener('gesturestart', cancel)
    document.addEventListener('gesturechange', cancel)
    document.addEventListener('gestureend', cancel)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('focusout', resetScroll)
    window.addEventListener('orientationchange', resetScroll)

    return () => {
      document.removeEventListener('gesturestart', cancel)
      document.removeEventListener('gesturechange', cancel)
      document.removeEventListener('gestureend', cancel)
      document.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('focusout', resetScroll)
      window.removeEventListener('orientationchange', resetScroll)
    }
  }, [])
}
