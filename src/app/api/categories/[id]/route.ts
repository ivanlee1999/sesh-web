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

    const collision = db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(name, id)
    if (collision) {
      return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 })
    }

    const oldName = existing.name

    db.transaction(() => {
      db.prepare('UPDATE categories SET name = ?, label = ?, color = ? WHERE id = ?').run(name, label, color, id)

      if (oldName !== name) {
        db.prepare('UPDATE sessions SET category = ? WHERE category = ?').run(name, oldName)
        db.prepare('UPDATE timer_state SET category = ?, updated_at = ? WHERE category = ?').run(name, Date.now(), oldName)
      }
    })()

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

    const timerRef = db.prepare('SELECT id FROM timer_state WHERE category = ?').get(existing.name) as { id: number } | undefined

    db.transaction(() => {
      if (timerRef) {
        db.prepare('UPDATE timer_state SET category = ?, updated_at = ? WHERE category = ?').run('other', Date.now(), existing.name)
      }
      db.prepare('DELETE FROM categories WHERE id = ?').run(id)
    })()

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}
