import { describe, it, expect } from 'vitest'
import {
  accentFor, accentPair, applyAccent, applyThemeColor, groundFor, readableInk,
  DEFAULT_ACCENT, THEME_COLOR_DARK, THEME_COLOR_LIGHT,
} from '../accent'

/** WCAG relative luminance, written out again so the tests don't trust the module's own maths. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('accentFor', () => {
  it('leaves a colour that already reads on its ground alone', () => {
    expect(accentFor('#6E86B0', false).base).toBe('#6e86b0')
    expect(accentFor('#C8943A', true).base).toBe('#c8943a')
  })

  it('lifts a near-black category off the focus ground', () => {
    const dark = accentFor('#2d2b2b', true)
    expect(dark.base).not.toBe('#2d2b2b')
    expect(luminance(dark.base)).toBeGreaterThanOrEqual(0.28)
  })

  it('darkens a colour that would disappear into the paper', () => {
    const light = accentFor('#ffe600', false)
    expect(luminance(light.base)).toBeLessThanOrEqual(0.5)
  })

  it('picks ink that clears 3:1 against the accent it sits on', () => {
    for (const color of ['#ec3013', '#C8943A', '#7E9476', '#2d2b2b', '#ffe600', '#9b9797']) {
      for (const dark of [false, true]) {
        const theme = accentFor(color, dark)
        expect(contrast(theme.base, theme.on)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('falls back to the default red rather than emitting a broken colour', () => {
    expect(accentFor('not a colour', false).base).toBe(DEFAULT_ACCENT)
    expect(accentFor('', false).base).toBe(DEFAULT_ACCENT)
  })

  it('reads three-digit hex', () => {
    expect(accentFor('#0a5', false).base).toBe('#00aa55')
  })
})

describe('readableInk', () => {
  it('keeps white on the saturated end and flips to ink on the pale end', () => {
    expect(readableInk('#ec3013')).toBe('#ffffff')
    expect(readableInk('#C8943A')).toBe('#201e1d')
  })
})

describe('applyAccent', () => {
  it('writes the two variables the whole ramp is mixed from', () => {
    const root = document.createElement('div')
    applyAccent(root, accentPair('#7E9476').light)
    expect(root.style.getPropertyValue('--accent-base')).toBe('#7e9476')
    expect(root.style.getPropertyValue('--accent-on')).toBe('#ffffff')
  })
})

describe('groundFor', () => {
  it('lands every category at one depth, whatever it started at', () => {
    // A gold and a slate blue are far apart in luminance to begin with; the
    // room they become must not be.
    for (const color of ['#BE6E45', '#C8943A', '#7E9476', '#6E86B0', '#5E9AA0']) {
      expect(luminance(groundFor(color))).toBeLessThanOrEqual(0.02)
      expect(luminance(groundFor(color))).toBeGreaterThan(0.012)
    }
  })

  it('keeps the hue it came from', () => {
    // Darkened toward black, so the channel ordering of the source survives:
    // a warm colour stays warm, a cool one stays cool.
    const warm = groundFor('#BE6E45')
    const cool = groundFor('#6E86B0')
    const chan = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    expect(chan(warm)[0]).toBeGreaterThan(chan(warm)[2])
    expect(chan(cool)[2]).toBeGreaterThan(chan(cool)[0])
  })

  it('stays legible under the accent that sits on it', () => {
    for (const color of ['#BE6E45', '#C8943A', '#7E9476', '#6E86B0', '#2d2b2b']) {
      expect(contrast(accentFor(color, true).base, groundFor(color))).toBeGreaterThanOrEqual(3)
    }
  })

  it('travels on the theme, so applying one paints the room too', () => {
    const root = document.createElement('div')
    applyAccent(root, accentPair('#6E86B0').dark)
    expect(root.style.getPropertyValue('--accent-ground')).toBe(groundFor('#6E86B0'))
  })
})

describe('applyThemeColor', () => {
  function meta() {
    return (document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null)?.content
  }

  it('takes the plain grounds when no session is running', () => {
    const root = document.documentElement
    delete root.dataset.focusmode
    applyThemeColor(root, false)
    expect(meta()).toBe(THEME_COLOR_LIGHT)
    applyThemeColor(root, true)
    expect(meta()).toBe(THEME_COLOR_DARK)
  })

  it('takes the session ground while one is running', () => {
    const root = document.documentElement
    applyAccent(root, accentPair('#6E86B0').dark)
    root.dataset.focusmode = 'true'
    applyThemeColor(root, true)
    expect(meta()).toBe(groundFor('#6E86B0'))
  })

  it('falls back rather than emptying the chrome when no accent is set yet', () => {
    const root = document.documentElement
    root.style.removeProperty('--accent-ground')
    root.dataset.focusmode = 'true'
    applyThemeColor(root, true)
    expect(meta()).toBe(THEME_COLOR_DARK)
  })
})
