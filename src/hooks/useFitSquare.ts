'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Measures a container and returns the largest square that fits inside it,
 * clamped to [min, max].
 *
 * The idle dial is the only elastic element on the focus screen: every other
 * row has a fixed height, so letting the dial absorb whatever is left over is
 * what keeps the screen from overflowing (and therefore scrolling) on short
 * viewports. Returns `max` until the container reports a real box, so SSR and
 * jsdom keep the CSS-declared size.
 */
export function useFitSquare(max: number, min = 104) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState(max)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    const fit = Math.floor(Math.min(box.width, box.height))
    if (fit <= 0) return
    setSize(Math.max(min, Math.min(max, fit)))
  }, [max, min])

  useEffect(() => {
    measure()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  return [ref, size] as const
}
