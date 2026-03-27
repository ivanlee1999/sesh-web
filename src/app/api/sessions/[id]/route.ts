import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const db = getDb()
    db.prepare('DELETE FROM sessions WHERE id = ?').run(params.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
