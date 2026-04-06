import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect('/?error=no_code')

  const clientId = process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
  const redirectUri = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/google/callback`

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    })
    const tokens = await res.json()
    if (!tokens.access_token) throw new Error('no token')

    const expiresAt = Date.now() + (tokens.expires_in * 1000)

    // Preserve existing refresh_token if Google omits it on re-auth
    const db = getDb()
    const existing = db.prepare('SELECT refresh_token FROM google_oauth WHERE id = 1').get() as { refresh_token: string } | undefined
    const refreshToken = tokens.refresh_token || existing?.refresh_token || ''

    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    }

    // Store in server DB for cross-device sync
    db.prepare(`
      UPDATE google_oauth SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
      WHERE id = 1
    `).run(tokenData.access_token, tokenData.refresh_token, tokenData.expires_at, Date.now())

    // Also set cookie for this device's session
    const response = NextResponse.redirect(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/?tab=settings`)
    response.cookies.set('google_tokens', JSON.stringify(tokenData), {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60,
      path: '/',
    })
    return response
  } catch {
    return NextResponse.redirect('/?error=auth_failed')
  }
}
