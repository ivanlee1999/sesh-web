/**
 * Cross-platform haptic feedback.
 * - Android: navigator.vibrate()
 * - iOS Safari 17.4+: input[switch] checkbox hack
 *   (create → append to head → click → remove, all in one frame)
 */

const supportsHaptics =
  typeof window === 'undefined'
    ? false
    : typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false

function haptic() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && navigator.vibrate) {
      navigator.vibrate(1)
      return
    }

    if (!supportsHaptics) return

    const labelEl = document.createElement('label')
    labelEl.ariaHidden = 'true'
    labelEl.style.display = 'none'

    const inputEl = document.createElement('input')
    inputEl.type = 'checkbox'
    inputEl.setAttribute('switch', '')
    labelEl.appendChild(inputEl)

    document.head.appendChild(labelEl)
    labelEl.click()
    document.head.removeChild(labelEl)
  } catch {
    // silently fail
  }
}

/** Stronger haptic for emphasis (multiples of 5) */
haptic.strong = () => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && navigator.vibrate) {
      navigator.vibrate(10)
      return
    }

    // Double tap for emphasis on iOS
    haptic()
    setTimeout(() => haptic(), 80)
  } catch {
    // silently fail
  }
}

export { haptic, supportsHaptics }
