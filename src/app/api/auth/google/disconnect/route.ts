import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

export async function GET() {
  // Legacy GET support — redirect-based disconnect
  const db = getDb()
  db.prepare(`UPDATE google_oauth SET access_token = '', refresh_token = '', expires_at = 0, updated_at = ? WHERE id = 1`).run(Date.now())

  const response = NextResponse.redirect(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/`)
  response.cookies.delete('google_tokens')
  return response
}

export async function POST() {
  // JSON-based disconnect for UI
  const db = getDb()
  db.prepare(`UPDATE google_oauth SET access_token = '', refresh_token = '', expires_at = 0, updated_at = ? WHERE id = 1`).run(Date.now())

  const response = NextResponse.json({ ok: true })
  response.cookies.delete('google_tokens')
  return response
}
