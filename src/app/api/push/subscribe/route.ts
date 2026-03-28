import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const db = getDb()
  const body = await request.json()

  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth
  `).run(endpoint, p256dh, auth, Math.floor(Date.now() / 1000))

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const db = getDb()
  const body = await request.json()
  const endpoint = body?.endpoint

  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
  }

  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
  return NextResponse.json({ ok: true })
}
