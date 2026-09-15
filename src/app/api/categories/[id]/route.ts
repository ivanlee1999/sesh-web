import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { slugifyLabel } from '@/lib/categories'
import {
  deleteCategory,
  findCategoryById,
  findCategoryByName,
  liveSessionCountForCategory,
  renameCategory,
  rowToCategoryJson,
} from '@/lib/categories-server'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const db = getDb()

    const existing = findCategoryById(db, id)
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    const label = (body.label ?? existing.label).trim()
    const name = slugifyLabel(label)
    const color = body.color ?? existing.color

    if (!name) {
      return NextResponse.json({ error: 'Invalid label' }, { status: 400 })
    }

    if (findCategoryByName(db, name, id)) {
      return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 })
    }

    const updated = renameCategory(db, existing, { name, label, color })
    return NextResponse.json(rowToCategoryJson(updated))
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

    const existing = findCategoryById(db, id)
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // A category with history behind it is refused, not deleted: those sessions
    // reference it by slug and would lose their colour and their name.
    const sessionCount = liveSessionCountForCategory(db, existing.name)
    if (sessionCount > 0) {
      return NextResponse.json(
        { error: 'Category is in use', sessionCount },
        { status: 409 }
      )
    }

    deleteCategory(db, existing)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}
