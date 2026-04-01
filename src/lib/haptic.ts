/**
 * Cross-platform haptic feedback.
 * - Android: navigator.vibrate()
 * - iOS: not supported during drag gestures
 */

function haptic() {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(15)
    }
  } catch {
    // silently fail
  }
}

/** Stronger haptic for emphasis (multiples of 5) */
haptic.strong = () => {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(30)
    }
  } catch {
    // silently fail
  }
}

export { haptic }
