import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

export async function POST(req: NextRequest) {
  const { access_token, refresh_token, expires_at } = await req.json()
  const db = getDb()
  
  db.prepare(`
    UPDATE google_oauth SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
    WHERE id = 1
  `).run(access_token || '', refresh_token || '', expires_at || 0, Date.now())
  
  return NextResponse.json({ ok: true })
}
