import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/server-db'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { device_code } = await req.json()
  
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  const data = await res.json()
  
  if (data.access_token) {
    const tokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    }

    // Store in server DB for cross-device access
    const db = getDb()
    db.prepare(`
      UPDATE google_oauth SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
      WHERE id = 1
    `).run(tokenData.access_token, tokenData.refresh_token || '', tokenData.expires_at, Date.now())

    // Also set cookie for this device
    const cookieStore = await cookies()
    cookieStore.set('google_tokens', JSON.stringify(tokenData), {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60,
      path: '/',
    })
    return NextResponse.json({ success: true })
  }
  
  return NextResponse.json(data)
}
