import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const tokenCookie = req.cookies.get('google_tokens')
  if (!tokenCookie) return NextResponse.json({ connected: false })

  try {
    const tokens = JSON.parse(tokenCookie.value)
    return NextResponse.json({ connected: !!tokens.access_token })
  } catch {
    return NextResponse.json({ connected: false })
  }
}
