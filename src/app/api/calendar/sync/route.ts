import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

const GOOGLE_CALENDAR_COLOR_IDS: Record<string, string> = {
  development: '9',
  writing: '3',
  design: '6',
  learning: '5',
  exercise: '10',
  other: '8',
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error('Failed to refresh token')
  const data = await res.json()
  return {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in * 1000),
  }
}

async function createCalendarEvent(accessToken: string, event: Record<string, unknown>) {
  return fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function buildDefaultSummary(type: string): string {
  if (type === 'focus') return 'Focus Session'
  if (type === 'short-break') return 'Short Break'
  if (type === 'long-break') return 'Long Break'
  return 'Session'
}

export async function POST(req: NextRequest) {
  // Read tokens from server DB instead of cookies
  const db = getDb()
  const row = db.prepare('SELECT access_token, refresh_token, expires_at FROM google_oauth WHERE id = 1').get() as { access_token: string; refresh_token?: string; expires_at: number } | undefined

  if (!row?.access_token) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 401 })
  }

  let tokens = { access_token: row.access_token, refresh_token: row.refresh_token, expires_at: row.expires_at }

  const body = await req.json()
  const { intention, category, type, startedAt, endedAt, targetMs, actualMs, overflowMs } = body

  const start = new Date(startedAt)
  const end = new Date(endedAt)

  const typeLabel = type === 'focus' ? 'Focus' : type === 'short-break' ? 'Short Break' : 'Long Break'
  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)
  let description = `Category: ${categoryLabel}\nType: ${typeLabel}\nDuration: ${formatDuration(actualMs || (endedAt - startedAt))}`
  if (targetMs) description += `\nTarget: ${formatDuration(targetMs)}`
  if (overflowMs && overflowMs > 0) description += `\nOverflow: +${formatDuration(overflowMs)}`

  const event = {
    summary: intention || buildDefaultSummary(type),
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    colorId: GOOGLE_CALENDAR_COLOR_IDS[category] || '8',
  }

  // Refresh if expired
  if (tokens.expires_at < Date.now() && tokens.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(tokens.refresh_token)
      tokens.access_token = refreshed.access_token
      tokens.expires_at = refreshed.expires_at
      // Store refreshed tokens back to DB
      db.prepare(`UPDATE google_oauth SET access_token = ?, expires_at = ?, updated_at = ? WHERE id = 1`)
        .run(tokens.access_token, tokens.expires_at, Date.now())
    } catch {
      return NextResponse.json({ error: 'Token refresh failed' }, { status: 401 })
    }
  }

  try {
    let res = await createCalendarEvent(tokens.access_token, event)

    if (res.status === 401 && tokens.refresh_token) {
      try {
        const refreshed = await refreshAccessToken(tokens.refresh_token)
        tokens.access_token = refreshed.access_token
        tokens.expires_at = refreshed.expires_at
        db.prepare(`UPDATE google_oauth SET access_token = ?, expires_at = ?, updated_at = ? WHERE id = 1`)
          .run(tokens.access_token, tokens.expires_at, Date.now())
        res = await createCalendarEvent(tokens.access_token, event)
      } catch {
        return NextResponse.json({ error: 'Token refresh failed' }, { status: 401 })
      }
    }

    if (!res.ok) throw new Error(await res.text())
    return NextResponse.json({ id: (await res.json()).id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
