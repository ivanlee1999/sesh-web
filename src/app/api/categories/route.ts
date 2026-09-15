import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { slugifyLabel } from '@/lib/categories'
import { type CategoryRow, renameCategory, rowToCategoryJson } from '@/lib/categories-server'

export async function GET() {
  try {
    const db = getDb()
    const rows = db.prepare(
      'SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, label',
    ).all() as CategoryRow[]
    return NextResponse.json(rows.map(rowToCategoryJson))
  } catch {
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const label = (body.label ?? '').trim()
    if (!label) {
      return NextResponse.json({ error: 'Label is required' }, { status: 400 })
    }

    const name = slugifyLabel(label)
    if (!name) {
      return NextResponse.json({ error: 'Invalid label' }, { status: 400 })
    }

    const color = body.color ?? '#6b7280'

    const db = getDb()

    const existing = db.prepare('SELECT * FROM categories WHERE name = ?').get(name) as CategoryRow | undefined
    if (existing && existing.deleted_at === null) {
      return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 })
    }

    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM categories').get() as { m: number | null }
    const sortOrder = (maxOrder.m ?? -1) + 1

    /*
     * A deleted category still holds its slug — the name is UNIQUE and the row
     * has to stay so other devices learn of the deletion. Making "Study" again
     * therefore revives the old row rather than failing on a name collision
     * the person cannot see and has no way to clear.
     */
    if (existing) {
      const revived = renameCategory(db, existing, { name, label, color, sortOrder })
      return NextResponse.json(rowToCategoryJson(revived), { status: 201 })
    }

    const id = crypto.randomUUID()
    db.prepare(
      'INSERT INTO categories (id, name, label, color, sort_order, is_default) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(id, name, label, color, sortOrder)

    return NextResponse.json({
      id,
      name,
      label,
      color,
      sortOrder,
      isDefault: false,
    }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
}
