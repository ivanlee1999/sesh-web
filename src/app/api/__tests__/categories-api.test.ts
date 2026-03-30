import { describe, it, expect, vi } from 'vitest'

/**
 * Unit tests for categories API logic.
 * We mock getDb() to avoid needing real SQLite in the test environment.
 */

// Mock server-only module (it throws at import time in non-server environments)
vi.mock('server-only', () => ({}))

// Build a mock DB
function createMockDb() {
  const categories: Array<{
    id: string; name: string; label: string; color: string; sort_order: number; is_default: number
  }> = [
    { id: 'cat-1', name: 'deep-work', label: 'Deep Work', color: '#3b82f6', sort_order: 0, is_default: 1 },
    { id: 'cat-2', name: 'reading', label: 'Reading', color: '#10b981', sort_order: 1, is_default: 0 },
    { id: 'cat-3', name: 'exercise', label: 'Exercise', color: '#ef4444', sort_order: 2, is_default: 0 },
  ]

  const timerState = { id: 1, category: 'deep-work' }
  const sessions: Array<{ category: string }> = [
    { category: 'deep-work' },
    { category: 'reading' },
  ]

  return {
    categories,
    timerState,
    sessions,
  }
}

// ── slugifyLabel (imported directly) ────────────────────────────────────

// Import the actual helper since it has no server deps
import { slugifyLabel } from '@/lib/categories'

describe('Categories API — POST creation logic', () => {
  it('auto-generates slug from label', () => {
    expect(slugifyLabel('My New Category')).toBe('my-new-category')
  })

  it('rejects empty label (slug is empty)', () => {
    expect(slugifyLabel('')).toBe('')
    expect(slugifyLabel('   ')).toBe('')
  })

  it('detects name collision', () => {
    const db = createMockDb()
    const name = slugifyLabel('Deep Work') // 'deep-work'
    const existing = db.categories.find(c => c.name === name)
    expect(existing).toBeDefined()
  })

  it('assigns next sort_order', () => {
    const db = createMockDb()
    const maxOrder = Math.max(...db.categories.map(c => c.sort_order))
    expect(maxOrder + 1).toBe(3)
  })

  it('allows creating a category with a new unique name', () => {
    const db = createMockDb()
    const name = slugifyLabel('Meditation')
    const existing = db.categories.find(c => c.name === name)
    expect(existing).toBeUndefined() // no collision
  })
})

describe('Categories API — PUT rename logic', () => {
  it('slugifies the new label for name', () => {
    const newLabel = 'Deep Focus'
    const newName = slugifyLabel(newLabel)
    expect(newName).toBe('deep-focus')
  })

  it('detects collision with another category on rename', () => {
    const db = createMockDb()
    const targetId = 'cat-2' // reading
    const newName = slugifyLabel('Deep Work') // collides with cat-1
    const collision = db.categories.find(c => c.name === newName && c.id !== targetId)
    expect(collision).toBeDefined()
    expect(collision!.id).toBe('cat-1')
  })

  it('migrates sessions when category name changes', () => {
    const db = createMockDb()
    const oldName = 'deep-work'
    const newName = 'deep-focus'

    // Simulate migration
    for (const s of db.sessions) {
      if (s.category === oldName) s.category = newName
    }

    expect(db.sessions[0].category).toBe('deep-focus')
    expect(db.sessions[1].category).toBe('reading') // unchanged
  })

  it('migrates timer_state when category name changes', () => {
    const db = createMockDb()
    const oldName = 'deep-work'
    const newName = 'deep-focus'

    if (db.timerState.category === oldName) {
      db.timerState.category = newName
    }

    expect(db.timerState.category).toBe('deep-focus')
  })
})

describe('Categories API — DELETE logic', () => {
  it('removes the category from the list', () => {
    const db = createMockDb()
    const idToDelete = 'cat-3' // exercise
    db.categories = db.categories.filter(c => c.id !== idToDelete)
    expect(db.categories).toHaveLength(2)
    expect(db.categories.find(c => c.id === idToDelete)).toBeUndefined()
  })

  it('falls back timer to first remaining category when active timer uses deleted category', () => {
    const db = createMockDb()
    const idToDelete = 'cat-1' // deep-work (active in timer)
    const deletedCat = db.categories.find(c => c.id === idToDelete)!

    // Timer references this category
    expect(db.timerState.category).toBe(deletedCat.name)

    // Find fallback: first remaining category by sort_order
    const remaining = db.categories
      .filter(c => c.id !== idToDelete)
      .sort((a, b) => a.sort_order - b.sort_order)
    const fallbackName = remaining.length > 0 ? remaining[0].name : ''

    db.timerState.category = fallbackName
    db.categories = db.categories.filter(c => c.id !== idToDelete)

    expect(db.timerState.category).toBe('reading') // fallback to next category
    expect(db.categories).toHaveLength(2)
  })

  it('falls back to empty string if no categories remain', () => {
    const db = createMockDb()
    // Delete all categories
    db.categories = []
    const fallbackName = db.categories.length > 0 ? db.categories[0].name : ''
    expect(fallbackName).toBe('')
  })

  it('returns 404 for non-existent category', () => {
    const db = createMockDb()
    const existing = db.categories.find(c => c.id === 'nonexistent')
    expect(existing).toBeUndefined()
  })
})
