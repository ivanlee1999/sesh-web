import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const settings: Record<string, unknown> = {}
  for (const row of rows) {
    try { settings[row.key] = JSON.parse(row.value) } catch { settings[row.key] = row.value }
  }
  return NextResponse.json(settings)
}

export async function PUT(req: NextRequest) {
  const db = getDb()
  const body = await req.json()
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      const v = JSON.stringify(value)
      upsert.run(key, v, v)
    }
  })
  tx()
  return NextResponse.json({ ok: true })
}
