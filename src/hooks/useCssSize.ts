'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Reads a numeric px value out of a CSS custom property on :root and keeps it
 * in sync with viewport changes.
 *
 * Layout scale lives in globals.css (one source of truth across breakpoints),
 * but SVG-based components need a real number for width/height — this bridges
 * the two without duplicating the breakpoint table in JS.
 */
export function useCssSize(varName: string, fallback: number): number {
  const read = useCallback(() => {
    if (typeof window === 'undefined') return fallback
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName)
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }, [fallback, varName])

  const [size, setSize] = useState(fallback)

  useEffect(() => {
    const sync = () => setSize(read())
    sync()

    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [read])

  return size
}
