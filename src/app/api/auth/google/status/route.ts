import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const db = getDb()

  // Check server DB — connected if we have a refresh_token (access_token can be refreshed)
  const row = db.prepare('SELECT access_token, refresh_token, expires_at FROM google_oauth WHERE id = 1').get() as { access_token: string; refresh_token: string; expires_at: number } | undefined
  if (row?.refresh_token) {
    return NextResponse.json({
      connected: true,
      accessTokenExpired: row.expires_at <= Date.now(),
    })
  }

  // Fallback: check cookie
  const tokenCookie = req.cookies.get('google_tokens')
  if (tokenCookie) {
    try {
      const tokens = JSON.parse(tokenCookie.value)
      if (tokens.refresh_token) {
        return NextResponse.json({
          connected: true,
          accessTokenExpired: (tokens.expires_at || 0) <= Date.now(),
        })
      }
    } catch { /* ignore */ }
  }

  return NextResponse.json({ connected: false, accessTokenExpired: false })
}
