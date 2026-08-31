'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { clearPaneWidth, loadPaneLayout, savePaneWidth, type PaneKey } from '@/lib/local-store'

export interface PaneBounds {
  /** Below this the pane stops being usable, so the drag simply stops. */
  min: number
  max: number
  /** The designed width, used until someone drags and again on reset. */
  fallback: number
}

/**
 * A desktop pane the viewer can widen or narrow, remembered per device.
 *
 * Starts at the designed width on both server and first client paint — the
 * stored value is read in an effect — so nothing here can cause a hydration
 * mismatch, and a viewer who has never dragged sees exactly the handoff's
 * layout.
 *
 * The width is held in state during a drag and only written to storage when
 * the pointer is released: persisting every pointermove would write to
 * localStorage a hundred times a second for no benefit.
 */
export function usePaneWidth(key: PaneKey, bounds: PaneBounds) {
  const { min, max, fallback } = bounds
  const [width, setWidth] = useState(fallback)
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(fallback)

  const clamp = useCallback((value: number) => {
    // Never let a pane take so much of a narrow window that what it is beside
    // has nowhere to go, whatever the stored or dragged value says.
    const ceiling = typeof window === 'undefined' ? max : Math.min(max, Math.round(window.innerWidth * 0.4))
    return Math.max(min, Math.min(Math.max(min, ceiling), Math.round(value)))
  }, [max, min])

  const apply = useCallback((value: number) => {
    const next = clamp(value)
    widthRef.current = next
    setWidth(next)
    return next
  }, [clamp])

  useEffect(() => {
    const stored = loadPaneLayout()[key]
    if (stored !== undefined) apply(stored)
    // Only on mount: afterwards this pane's width is whatever the viewer set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const reset = useCallback(() => {
    clearPaneWidth(key)
    widthRef.current = fallback
    setWidth(fallback)
  }, [fallback, key])

  /**
   * @param towards `start` for a pane on the left of its handle, `end` for one
   *   on the right — the two grow in opposite directions.
   */
  const startDrag = useCallback((event: React.PointerEvent, towards: 'start' | 'end') => {
    event.preventDefault()
    const originX = event.clientX
    const originWidth = widthRef.current
    const sign = towards === 'start' ? 1 : -1

    setDragging(true)
    // The pointer leaves the 2px handle immediately, so the cursor and the
    // no-select guard have to live on the document for the whole drag.
    document.documentElement.dataset.resizing = 'true'

    const move = (moveEvent: PointerEvent) => {
      apply(originWidth + sign * (moveEvent.clientX - originX))
    }

    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      delete document.documentElement.dataset.resizing
      setDragging(false)
      savePaneWidth(key, widthRef.current)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [apply, key])

  /** Arrow keys nudge; Home restores the designed width. */
  const nudge = useCallback((delta: number) => {
    savePaneWidth(key, apply(widthRef.current + delta))
  }, [apply, key])

  // A window that shrinks can strand a pane wider than the ceiling allows.
  useEffect(() => {
    const onResize = () => apply(widthRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [apply])

  return { width, dragging, startDrag, nudge, reset }
}
