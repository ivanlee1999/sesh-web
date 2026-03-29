import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { slugifyLabel } from '@/lib/categories'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const db = getDb()

    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as {
      id: string; name: string; label: string; color: string; sort_order: number; is_default: number
    } | undefined

    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    const label = (body.label ?? existing.label).trim()
    const name = slugifyLabel(label)
    const color = body.color ?? existing.color

    if (!name) {
      return NextResponse.json({ error: 'Invalid label' }, { status: 400 })
    }

    // Check for name collision with another category
    const collision = db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(name, id)
    if (collision) {
      return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 })
    }

    db.prepare('UPDATE categories SET name = ?, label = ?, color = ? WHERE id = ?').run(name, label, color, id)

    return NextResponse.json({
      id,
      name,
      label,
      color,
      sortOrder: existing.sort_order,
      isDefault: existing.is_default === 1,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const db = getDb()

    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as {
      id: string; name: string; is_default: number
    } | undefined

    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    if (existing.is_default === 1) {
      return NextResponse.json({ error: 'Cannot delete a default category' }, { status: 409 })
    }

    const sessionCount = (db.prepare('SELECT COUNT(*) as cnt FROM sessions WHERE category = ?').get(existing.name) as { cnt: number }).cnt
    if (sessionCount > 0) {
      return NextResponse.json(
        { error: 'Category has existing sessions', sessionCount },
        { status: 409 }
      )
    }

    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}
