import { describe, it, expect } from 'vitest'
import { slugifyLabel, getCategoryMeta, CATEGORY_PALETTE } from '../categories'
import type { CategoryRecord } from '@/types'

// ── slugifyLabel ────────────────────────────────────────────────────────

describe('slugifyLabel', () => {
  it('converts "My Category" to "my-category"', () => {
    expect(slugifyLabel('My Category')).toBe('my-category')
  })

  it('lowercases all characters', () => {
    expect(slugifyLabel('DEEP WORK')).toBe('deep-work')
  })

  it('replaces multiple special chars with a single dash', () => {
    expect(slugifyLabel('foo!!bar')).toBe('foo-bar')
  })

  it('strips leading and trailing dashes', () => {
    expect(slugifyLabel('--hello--')).toBe('hello')
    expect(slugifyLabel('  hello  ')).toBe('hello')
  })

  it('replaces unicode/emoji with dashes or strips them', () => {
    expect(slugifyLabel('café')).toBe('caf')
    expect(slugifyLabel('work & play')).toBe('work-play')
  })

  it('handles already-slugified input', () => {
    expect(slugifyLabel('deep-work')).toBe('deep-work')
  })

  it('handles numbers in label', () => {
    expect(slugifyLabel('Sprint 42')).toBe('sprint-42')
  })

  it('returns empty string for all-special-char input', () => {
    expect(slugifyLabel('!!!')).toBe('')
    expect(slugifyLabel('   ')).toBe('')
  })

  it('trims whitespace before processing', () => {
    expect(slugifyLabel('  Padded  ')).toBe('padded')
  })
})

// ── getCategoryMeta ─────────────────────────────────────────────────────

describe('getCategoryMeta', () => {
  const categories: CategoryRecord[] = [
    { id: '1', name: 'deep-work', label: 'Deep Work', color: '#3b82f6', sortOrder: 0, isDefault: true },
    { id: '2', name: 'reading', label: 'Reading', color: '#10b981', sortOrder: 1, isDefault: false },
  ]

  it('returns correct meta for a known category', () => {
    const meta = getCategoryMeta('deep-work', categories)
    expect(meta).toEqual({
      label: 'Deep Work',
      color: '#3b82f6',
      isUnknown: false,
    })
  })

  it('returns correct meta for another known category', () => {
    const meta = getCategoryMeta('reading', categories)
    expect(meta).toEqual({
      label: 'Reading',
      color: '#10b981',
      isUnknown: false,
    })
  })

  it('returns gray fallback for an unknown category', () => {
    const meta = getCategoryMeta('nonexistent', categories)
    expect(meta.color).toBe('#9ca3af')
    expect(meta.isUnknown).toBe(true)
  })

  it('title-cases the slug name for unknown categories', () => {
    const meta = getCategoryMeta('deep-work-old', categories)
    expect(meta.label).toBe('Deep Work Old')
    expect(meta.isUnknown).toBe(true)
  })

  it('handles underscores in unknown category names', () => {
    const meta = getCategoryMeta('my_category', categories)
    expect(meta.label).toBe('My Category')
    expect(meta.isUnknown).toBe(true)
  })

  it('returns fallback when categories list is empty', () => {
    const meta = getCategoryMeta('anything', [])
    expect(meta.isUnknown).toBe(true)
    expect(meta.color).toBe('#9ca3af')
  })
})

// ── CATEGORY_PALETTE ────────────────────────────────────────────────────

describe('CATEGORY_PALETTE', () => {
  it('has 12 colors', () => {
    expect(CATEGORY_PALETTE).toHaveLength(12)
  })

  it('all values are valid hex colors', () => {
    for (const color of CATEGORY_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
