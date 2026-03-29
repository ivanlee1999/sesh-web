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
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#10b981', '#14b8a6', '#06b6d4', '#6b7280',
]
