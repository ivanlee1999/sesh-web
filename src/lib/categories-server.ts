import type Database from 'better-sqlite3'

export interface CategoryRow {
  id: string
  name: string
  label: string
  color: string
  sort_order: number
  is_default: number
  seq: number
  updated_at: number
  deleted_at: number | null
}

export interface CategoryJson {
  id: string
  name: string
  label: string
  color: string
  sortOrder: number
  isDefault: boolean
}

export function rowToCategoryJson(row: CategoryRow): CategoryJson {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    color: row.color,
    sortOrder: row.sort_order,
    isDefault: row.is_default === 1,
  }
}

export function findCategoryById(db: Database.Database, id: string, includeDeleted = false): CategoryRow | undefined {
  return db.prepare(
    `SELECT * FROM categories WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
  ).get(id) as CategoryRow | undefined
}

/** A live category already holding this slug, ignoring the one being written. */
export function findCategoryByName(db: Database.Database, name: string, exceptId?: string): CategoryRow | undefined {
  return exceptId
    ? db.prepare('SELECT * FROM categories WHERE name = ? AND id != ? AND deleted_at IS NULL').get(name, exceptId) as CategoryRow | undefined
    : db.prepare('SELECT * FROM categories WHERE name = ? AND deleted_at IS NULL').get(name) as CategoryRow | undefined
}

/**
 * Rename and restyle a category, carrying everything that points at it.
 *
 * `sessions.category` and `timer_state.category` store the *slug*, not the id,
 * so a rename has to sweep them or a year of history detaches from its own
 * category and shows up as an unknown grey one. It is one transaction for that
 * reason: a half-applied rename is worse than a refused one.
 *
 * Shared with the sync route because a rename that happened on a phone has to
 * cascade in exactly the same way when it finally arrives.
 */
export function renameCategory(
  db: Database.Database,
  existing: CategoryRow,
  next: { name: string; label: string; color: string; sortOrder?: number; isDefault?: boolean; updatedAt?: number },
): CategoryRow {
  const sortOrder = next.sortOrder ?? existing.sort_order
  const isDefault = next.isDefault === undefined ? existing.is_default : (next.isDefault ? 1 : 0)
  const updatedAt = next.updatedAt ?? 0

  db.transaction(() => {
    db.prepare(`
      UPDATE categories
      SET name = ?, label = ?, color = ?, sort_order = ?, is_default = ?, deleted_at = NULL,
          updated_at = CASE WHEN ? > 0 THEN ? ELSE updated_at END
      WHERE id = ?
    `).run(next.name, next.label, next.color, sortOrder, isDefault, updatedAt, updatedAt, existing.id)

    if (existing.name !== next.name) {
      db.prepare('UPDATE sessions SET category = ? WHERE category = ?').run(next.name, existing.name)
      db.prepare('UPDATE timer_state SET category = ?, updated_at = ? WHERE category = ?')
        .run(next.name, Date.now(), existing.name)
    }
  })()

  return findCategoryById(db, existing.id, true) as CategoryRow
}

/**
 * How many sessions still stand behind a category. A deleted session does not
 * count — it is not going to lose its colour, it is already gone.
 */
export function liveSessionCountForCategory(db: Database.Database, name: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM sessions WHERE category = ? AND deleted_at IS NULL',
  ).get(name) as { count: number }
  return row.count
}

/**
 * Tombstone a category and move the timer off it, if it was sitting there.
 * Callers must check {@link liveSessionCountForCategory} first: a category with
 * history behind it is refused rather than deleted.
 */
export function deleteCategory(db: Database.Database, existing: CategoryRow): void {
  db.transaction(() => {
    const fallback = db.prepare(
      'SELECT name FROM categories WHERE id != ? AND deleted_at IS NULL ORDER BY sort_order LIMIT 1',
    ).get(existing.id) as { name: string } | undefined

    db.prepare('UPDATE timer_state SET category = ?, updated_at = ? WHERE category = ?')
      .run(fallback?.name ?? '', Date.now(), existing.name)
    db.prepare('UPDATE categories SET deleted_at = ? WHERE id = ?').run(Date.now(), existing.id)
  })()
}
