import { NextResponse } from 'next/server'

export async function POST() {
  const res = await fetch('https://oauth2.googleapis.com/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      scope: 'https://www.googleapis.com/auth/calendar.events',
    }),
  })
  const data = await res.json()
  // Returns: device_code, user_code, verification_url, expires_in, interval
  return NextResponse.json(data)
}
