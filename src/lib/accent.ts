/**
 * The accent, derived from a single colour.
 *
 * Every accent step in `globals.css` is mixed from `--accent-base`, so
 * re-theming the whole interface is a matter of pointing that one variable
 * somewhere else — at the category the timer is set to. This module decides
 * the two things CSS cannot work out on its own: how far a colour has to move
 * to stay legible on the ground behind it, and which ink to draw on top of it.
 *
 * The result is a *pair* — one answer for the light ground, one for the dark —
 * because both are computed once and stored, so the boot script can apply
 * whichever the interface is currently on without repeating the maths.
 */

/** The red the interface falls back to when no category has been chosen. */
export const DEFAULT_ACCENT = '#ec3013'

/** Matches `--color-text` on the light ground. */
const INK = '#201e1d'
const PAPER = '#ffffff'

/**
 * A category colour dark enough to vanish into the focus ground is lightened
 * until it clears this; one light enough to vanish into the paper is darkened
 * until it is under the other. Both are luminance, not lightness — a saturated
 * yellow and a saturated blue of the same "lightness" do not read the same.
 */
const DARK_GROUND_MIN_LUMINANCE = 0.28
const LIGHT_GROUND_MAX_LUMINANCE = 0.5

/** WCAG AA for large text, which is all the type an accent fill ever carries. */
const LARGE_TEXT_CONTRAST = 3

export interface AccentTheme {
  /** The colour every accent step is mixed from. */
  base: string
  /** The ink that stays legible on a surface filled with `base`. */
  on: string
}

export interface AccentPair {
  light: AccentTheme
  dark: AccentTheme
}

type Rgb = [number, number, number]

function parseHex(value: string): Rgb | null {
  const hex = value.trim().toLowerCase()
  const short = /^#([0-9a-f]{3})$/.exec(hex)
  if (short) {
    const [r, g, b] = short[1].split('')
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)]
  }
  const long = /^#([0-9a-f]{6})$/.exec(hex)
  if (!long) return null
  return [0, 2, 4].map(i => parseInt(long[1].slice(i, i + 2), 16)) as Rgb
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Rounded to whole channels, because that is what actually ships: the search
 * below has to test the colour that will be written, not a float that clears
 * the bar and then loses it to rounding.
 */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb
}

/** WCAG relative luminance. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(c => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The smallest move toward `target` that satisfies `ok`.
 *
 * Mixing toward white raises luminance and toward black lowers it, both
 * monotonically, so a bisection finds the least amount of correction that
 * works — a colour already legible is returned untouched, and one that needs
 * help is nudged rather than washed out.
 */
function nudge(rgb: Rgb, target: Rgb, ok: (lum: number) => boolean): Rgb {
  if (ok(luminance(rgb))) return rgb
  let lo = 0
  let hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (ok(luminance(mix(rgb, target, mid)))) hi = mid
    else lo = mid
  }
  return mix(rgb, target, hi)
}

/**
 * The ink for type sitting on an accent fill.
 *
 * White is the house style and stays unless it actually fails: the type on an
 * accent fill is 800-weight uppercase, so 3:1 is the bar it has to clear. Only
 * the pale end of the palette — a gold, a sand — falls through to dark ink.
 */
function inkOn(rgb: Rgb): string {
  return contrast(rgb, parseHex(PAPER) as Rgb) >= LARGE_TEXT_CONTRAST ? PAPER : INK
}

/**
 * The ink for type on any colour fill, not only the accent — the category
 * chips fill themselves with their own colour and need the same answer.
 */
export function readableInk(color: string): string {
  return inkOn(parseHex(color) ?? (parseHex(DEFAULT_ACCENT) as Rgb))
}

/** The accent as it should be drawn on one ground. */
export function accentFor(color: string, dark: boolean): AccentTheme {
  const rgb = parseHex(color) ?? (parseHex(DEFAULT_ACCENT) as Rgb)
  const adjusted = dark
    ? nudge(rgb, parseHex(PAPER) as Rgb, lum => lum >= DARK_GROUND_MIN_LUMINANCE)
    : nudge(rgb, [0, 0, 0], lum => lum <= LIGHT_GROUND_MAX_LUMINANCE)
  return { base: toHex(adjusted), on: inkOn(adjusted) }
}

export function accentPair(color: string): AccentPair {
  return { light: accentFor(color, false), dark: accentFor(color, true) }
}

/** Point the interface at one accent. Everything else is mixed from it in CSS. */
export function applyAccent(root: HTMLElement, theme: AccentTheme): void {
  root.style.setProperty('--accent-base', theme.base)
  root.style.setProperty('--accent-on', theme.on)
}
