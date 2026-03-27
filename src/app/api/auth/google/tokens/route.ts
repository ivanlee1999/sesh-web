import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getDb()
  const row = db.prepare('SELECT access_token, expires_at FROM google_oauth WHERE id = 1').get() as { access_token: string; expires_at: number } | undefined
  const connected = !!(row?.access_token && row.expires_at > Date.now())
  return NextResponse.json({ connected })
}
