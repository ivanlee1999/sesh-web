/**
 * Shared pieces of the Modernist UI that are logic rather than markup.
 *
 * Kept out of the components so the dial, the chips, the poster and the
 * settings swatches all agree on one colour rule and one clock format.
 */

/** The eight colours offered per category in Settings → Colours. */
export const SWATCHES = [
  '#c0522d', '#c98a1e', '#4f8f6e', '#3b6fa8',
  '#7a5ea8', '#b8465c', '#2b2927', '#8a857f',
] as const

/**
 * Ink-dark category colours are invisible on the dark focus ground, so they
 * are lifted to a ramp step. Anything already light enough, and the saturated
 * accent, passes through untouched — red stays the strongest thing on the
 * dial while a session runs.
 */
const DARK_LIFT: Record<string, string> = {
  '#2d2b2b': 'var(--color-neutral-400)',
  '#201e1d': 'var(--color-neutral-400)',
}

export function onDark(hex: string): string {
  const key = hex.toLowerCase()
  if (DARK_LIFT[key]) return DARK_LIFT[key]
  if (!/^#[0-9a-f]{6}$/.test(key)) return hex
  const [r, g, b] = [0, 2, 4].map(i => parseInt(key.slice(1 + i, 3 + i), 16))
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return lum >= 0.22 ? hex : 'var(--color-accent-400)'
}

/** The category colour to draw on whichever ground is currently behind it. */
export function dialColor(color: string, darkGround: boolean): string {
  return darkGround ? onDark(color) : color
}

export const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0')

/** MM:SS, floored at zero — overtime is counted separately, never as a sign. */
export function clockOf(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec))
  return `${pad2(safe / 60)}:${pad2(safe % 60)}`
}

export function hoursMinutes(totalMin: number): string {
  const safe = Math.max(0, Math.round(totalMin))
  const h = Math.floor(safe / 60)
  const m = safe % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
}

export function endsAtLabel(fromMs: number, minutes: number): string {
  const d = new Date(fromMs + minutes * 60000)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * Nothing scrolls, so a pane shows what fits and counts the rest.
 *
 * The budget counts rows *and* the group header above them, which is why each
 * group costs `shown + 1`. Once there is no room for a header plus one row,
 * everything still to come is rolled into a single trailing count.
 */
export interface CappedGroup<T> {
  label: string
  rows: T[]
  total: number
  more: string | null
}

export function capGroups<T>(
  groups: { label: string; rows: T[] }[],
  budget: number,
): CappedGroup<T>[] {
  let left = budget
  const out: CappedGroup<T>[] = []

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i]
    if (left <= 1) {
      const rest = groups.slice(i).reduce((n, g) => n + g.rows.length, 0)
      if (rest > 0 && out.length > 0) out[out.length - 1].more = `+${rest} more in later lists`
      break
    }
    const shown = group.rows.slice(0, left)
    out.push({
      label: group.label,
      rows: shown,
      total: group.rows.length,
      more: group.rows.length > shown.length
        ? `+${group.rows.length - shown.length} more · filter to see them`
        : null,
    })
    left -= shown.length + 1
  }

  return out
}
