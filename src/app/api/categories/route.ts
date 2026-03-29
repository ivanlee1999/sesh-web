import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { slugifyLabel } from '@/lib/categories'

export async function GET() {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM categories ORDER BY sort_order, label').all() as Array<{
      id: string; name: string; label: string; color: string; sort_order: number; is_default: number
    }>
    return NextResponse.json(
      rows.map(r => ({
        id: r.id,
        name: r.name,
        label: r.label,
        color: r.color,
        sortOrder: r.sort_order,
        isDefault: r.is_default === 1,
      }))
    )
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

    // Check for name collision
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name)
    if (existing) {
      return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 })
    }

    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM categories').get() as { m: number | null }
    const sortOrder = (maxOrder.m ?? -1) + 1
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
