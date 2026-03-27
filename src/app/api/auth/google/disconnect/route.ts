import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

export async function GET() {
  // Clear tokens from server DB (affects all devices)
  const db = getDb()
  db.prepare(`UPDATE google_oauth SET access_token = '', refresh_token = '', expires_at = 0, updated_at = ? WHERE id = 1`).run(Date.now())

  // Also clear cookie on this device
  const response = NextResponse.redirect(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/`)
  response.cookies.delete('google_tokens')
  return response
}
