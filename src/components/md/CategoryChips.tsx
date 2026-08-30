'use client'

import { useCallback, useEffect, useRef } from 'react'
import { MdIcon } from './icons'
import type { CategoryRecord } from '@/types'

const FADE = 'linear-gradient(to right, #000 0, #000 calc(100% - 30px), transparent 100%)'

const CHIP_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  border: '2px solid',
  padding: '7px 11px',
  cursor: 'pointer',
  fontFamily: 'var(--font-heading)',
  fontWeight: 800,
  fontSize: 11,
  letterSpacing: '.07em',
  textTransform: 'uppercase',
} as const

/**
 * The category picker as one scrolling line.
 *
 * On a phone the row bleeds to the screen edge and fades on the right, so a
 * half-visible chip signals there is more. On the desktop it keeps real
 * gutters and gains a chevron at each end — as flex *siblings*, never
 * overlays, so a chevron can't cover the chip it is meant to reveal.
 *
 * Two things here are deliberate, and both were bugs first:
 *
 *  1. The scroll handler mutates the DOM instead of setting React state. An
 *     `onScroll` that re-rendered thrashed the row badly enough to hang the
 *     page.
 *  2. "Not measurable yet" (`scrollWidth - clientWidth <= 2`) counts as
 *     ENABLED, and the chevrons never take `pointer-events: none`. A
 *     measurement taken before layout would otherwise latch a permanently
 *     dead control. `nudge` clamps instead, so a stale reading can dim a
 *     chevron but can never trap it.
 */
export default function CategoryChips({
  categories,
  active,
  onPick,
  phone,
}: {
  categories: CategoryRecord[]
  active: string
  onPick: (name: string) => void
  phone: boolean
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const updateArrows = useCallback((row: HTMLDivElement) => {
    const wrap = wrapRef.current
    if (!wrap) return

    const setDim = (label: string, dim: boolean) => {
      const btn = wrap.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      if (btn) btn.style.opacity = dim ? '0.28' : '1'
    }

    const max = row.scrollWidth - row.clientWidth
    if (max <= 2) {
      setDim('Previous categories', false)
      setDim('More categories', false)
      if (phone) {
        row.style.maskImage = FADE
        row.style.webkitMaskImage = FADE
      }
      return
    }

    setDim('Previous categories', row.scrollLeft <= 2)
    setDim('More categories', row.scrollLeft >= max - 2)
    if (phone) {
      const atEnd = row.scrollLeft >= max - 2
      row.style.maskImage = atEnd ? 'none' : FADE
      row.style.webkitMaskImage = atEnd ? 'none' : FADE
    }
  }, [phone])

  // Re-measure whenever the row's box changes — frame sizing, webfont metrics,
  // a renamed category — rather than guessing one settle time.
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    updateArrows(row)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => updateArrows(row))
    ro.observe(row)
    if (row.firstElementChild) ro.observe(row.firstElementChild)
    return () => ro.disconnect()
  }, [updateArrows, categories.length])

  const reveal = useCallback((index: number) => {
    const row = rowRef.current
    const chip = row?.children[index] as HTMLElement | undefined
    if (!row || !chip) return
    const max = row.scrollWidth - row.clientWidth
    row.scrollLeft = Math.max(0, Math.min(max, chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2))
    updateArrows(row)
  }, [updateArrows])

  // The selected chip is always brought into view — including when picking a
  // task, which sets the category for you and would otherwise leave the proof
  // of that off screen.
  useEffect(() => {
    const index = categories.findIndex(c => c.name === active)
    if (index >= 0) {
      const id = window.setTimeout(() => reveal(index), 30)
      return () => window.clearTimeout(id)
    }
  }, [active, categories, reveal])

  const nudge = (dir: number) => {
    const row = rowRef.current
    if (!row) return
    const max = row.scrollWidth - row.clientWidth
    row.scrollLeft = Math.max(0, Math.min(max, row.scrollLeft + dir * Math.max(140, row.clientWidth * 0.6)))
    updateArrows(row)
  }

  const chevron = (label: string, dir: number, icon: 'prev' | 'next') => (
    <button
      type="button"
      className="md-press md-lift"
      onClick={() => nudge(dir)}
      aria-label={label}
      style={{
        flex: 'none',
        width: 26,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '2px solid var(--color-divider)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        padding: 0,
        transition: 'opacity 180ms',
      }}
    >
      <MdIcon name={icon} size={13} strokeWidth={2.4} />
    </button>
  )

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
      {!phone && chevron('Previous categories', -1, 'prev')}

      <div
        ref={rowRef}
        className="md-hscroll"
        data-testid="timer-category-selector"
        onScroll={event => updateArrows(event.currentTarget)}
        style={{
          gap: 7,
          flex: 1,
          minWidth: 0,
          ...(phone
            ? {
              margin: '0 -18px',
              padding: '2px 18px',
              maskImage: FADE,
              WebkitMaskImage: FADE,
            }
            : { padding: '2px 0' }),
        }}
      >
        {categories.map(category => {
          const isActive = category.name === active
          return (
            <button
              key={category.id}
              type="button"
              className="md-press"
              data-active={isActive ? 'true' : 'false'}
              aria-pressed={isActive}
              onClick={() => onPick(category.name)}
              style={{
                ...CHIP_BASE,
                borderColor: isActive ? category.color : 'var(--color-divider)',
                background: isActive ? category.color : 'transparent',
                color: isActive ? '#fff' : 'inherit',
              }}
            >
              <span style={{ width: 8, height: 8, background: category.color, display: 'block' }} />
              {category.label}
            </button>
          )
        })}
      </div>

      {!phone && chevron('More categories', 1, 'next')}
    </div>
  )
}
