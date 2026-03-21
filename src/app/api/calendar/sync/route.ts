import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const tokenCookie = req.cookies.get('gcal_token')
  if (!tokenCookie) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let tokens: { access_token: string; refresh_token?: string }
  try {
    tokens = JSON.parse(tokenCookie.value)
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const body = await req.json()
  const { intention, category, type, startedAt, endedAt } = body

  const start = new Date(startedAt)
  const end = new Date(endedAt)

  const event = {
    summary: intention || `sesh: ${type}`,
    description: `Category: ${category}\nType: ${type}`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    colorId: category === 'development' ? '9' : category === 'writing' ? '3' : '6',
  }

  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    })
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()
    return NextResponse.json({ id: data.id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
