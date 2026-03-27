import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const db = getDb()
  
  // Check server DB
  const row = db.prepare('SELECT access_token, expires_at FROM google_oauth WHERE id = 1').get() as { access_token: string; expires_at: number } | undefined
  if (row?.access_token && row.expires_at > Date.now()) {
    return NextResponse.json({ connected: true })
  }
  
  // Fallback: check cookie - if it has refresh_token, consider it connected (we can refresh)
  const tokenCookie = req.cookies.get('google_tokens')
  if (tokenCookie) {
    try {
      const tokens = JSON.parse(tokenCookie.value)
      if (tokens.refresh_token) return NextResponse.json({ connected: true })
    } catch { /* ignore */ }
  }
  
  return NextResponse.json({ connected: false })
}
