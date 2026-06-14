import type { CategoryRecord } from '@/types'

export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getCategoryMeta(
  name: string,
  categories: CategoryRecord[]
): { label: string; color: string; isUnknown: boolean } {
  const found = categories.find(c => c.name === name)
  if (found) return { label: found.label, color: found.color, isUnknown: false }
  // Fallback for orphaned/unknown categories
  return {
    label: name
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase()),
    color: '#9ca3af',
    isUnknown: true,
  }
}

export const CATEGORY_PALETTE = [
  '#BE6E45', '#C8943A', '#7E9476', '#6E86B0',
  '#9B6F8C', '#C2615A', '#5E9AA0', '#8A7B5C',
]
