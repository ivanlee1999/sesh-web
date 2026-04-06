import { getDb } from '@/lib/server-db'

const GOOGLE_CALENDAR_COLOR_IDS: Record<string, string> = {
  development: '9', writing: '3', design: '6', learning: '5', exercise: '10', other: '8',
}

interface OAuthTokens {
  access_token: string
  refresh_token: string
  expires_at: number
  calendar_id: string
}

interface SessionData {
  id?: string
  intention?: string
  category: string
  type: string
  startedAt: number
  endedAt: number
  targetMs: number
  actualMs: number
  overflowMs: number
  googleEventId?: string
  isSynced?: boolean
}

interface SyncResult {
  synced: boolean
  skipped?: string
  eventId?: string
  error?: string
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_at: number }> {
  const clientId = process.env.GOOGLE_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  const data = await res.json()
  return { access_token: data.access_token, expires_at: Date.now() + (data.expires_in * 1000) }
}

async function getOrCreateSeshCalendar(accessToken: string): Promise<string> {
  const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (listRes.ok) {
    const listData = await listRes.json()
    const items = listData.items as Array<{ summary?: string; id?: string }> | undefined
    const seshCal = items?.find((cal) => cal.summary?.toLowerCase() === 'sesh')
    if (seshCal?.id) return seshCal.id
  }
  const createRes = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: 'sesh', description: 'Pomodoro session tracking', timeZone: 'America/Los_Angeles' }),
  })
  if (!createRes.ok) throw new Error('Failed to create sesh calendar')
  return (await createRes.json()).id
}

async function createCalendarEvent(accessToken: string, calendarId: string, event: Record<string, unknown>) {
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
}

async function updateCalendarEvent(accessToken: string, calendarId: string, eventId: string, event: Record<string, unknown>) {
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
}

/**
 * Get valid Google OAuth tokens, refreshing the access token if expired.
 * Returns null if not connected.
 */
async function getValidTokens(): Promise<OAuthTokens | null> {
  const db = getDb()
  const row = db.prepare(
    'SELECT access_token, refresh_token, expires_at, calendar_id FROM google_oauth WHERE id = 1'
  ).get() as OAuthTokens | undefined

  if (!row?.refresh_token) return null

  // Refresh access token if expired (with 60s buffer)
  if (row.expires_at < Date.now() + 60_000) {
    try {
      const refreshed = await refreshAccessToken(row.refresh_token)
      db.prepare(
        'UPDATE google_oauth SET access_token = ?, expires_at = ?, updated_at = ? WHERE id = 1'
      ).run(refreshed.access_token, refreshed.expires_at, Date.now())
      return { ...row, access_token: refreshed.access_token, expires_at: refreshed.expires_at }
    } catch {
      return null // Refresh token is likely invalid
    }
  }

  return row
}

/**
 * Check whether calendar sync is enabled in user settings.
 */
function isCalendarSyncEnabled(): boolean {
  const db = getDb()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'calendarSync'").get() as { value: string } | undefined
  if (!row) return false
  try {
    return JSON.parse(row.value) === true
  } catch {
    return false
  }
}

/**
 * Sync a completed session to Google Calendar.
 * Non-fatal: returns a result object instead of throwing.
 */
export async function syncSessionToGoogleCalendar(session: SessionData): Promise<SyncResult> {
  // Check if calendar sync is enabled in settings
  if (!isCalendarSyncEnabled()) {
    return { synced: false, skipped: 'disabled' }
  }

  // Get valid tokens
  let tokens: OAuthTokens | null
  try {
    tokens = await getValidTokens()
  } catch {
    return { synced: false, skipped: 'token_error' }
  }
  if (!tokens) {
    return { synced: false, skipped: 'not_connected' }
  }

  // Get or create the sesh calendar (use cached calendar_id if available)
  const db = getDb()
  let calendarId = tokens.calendar_id || ''
  if (!calendarId) {
    try {
      calendarId = await getOrCreateSeshCalendar(tokens.access_token)
      // Cache calendar ID for future calls
      db.prepare('UPDATE google_oauth SET calendar_id = ? WHERE id = 1').run(calendarId)
    } catch (err) {
      return { synced: false, error: `Failed to get/create calendar: ${err}` }
    }
  }

  // Build the event
  const start = new Date(session.startedAt)
  const end = new Date(session.endedAt)
  const typeLabel = session.type === 'focus' ? 'Focus' : 'Break'
  const categoryLabel = session.category.charAt(0).toUpperCase() + session.category.slice(1)
  let description = `Category: ${categoryLabel}\nType: ${typeLabel}\nDuration: ${formatDuration(session.actualMs || (session.endedAt - session.startedAt))}`
  if (session.targetMs) description += `\nTarget: ${formatDuration(session.targetMs)}`
  if (session.overflowMs && session.overflowMs > 0) description += `\nOverflow: +${formatDuration(session.overflowMs)}`

  const event = {
    summary: session.intention || (session.type === 'focus' ? 'Focus Session' : 'Break'),
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    colorId: GOOGLE_CALENDAR_COLOR_IDS[session.category] || '8',
  }

  // Create or update event, with one retry on 401
  const shouldUpdate = session.isSynced && !!session.googleEventId
  try {
    let res = shouldUpdate
      ? await updateCalendarEvent(tokens.access_token, calendarId, session.googleEventId!, event)
      : await createCalendarEvent(tokens.access_token, calendarId, event)

    if (res.status === 401 && tokens.refresh_token) {
      // Access token may have been invalidated; try refreshing once more
      try {
        const refreshed = await refreshAccessToken(tokens.refresh_token)
        db.prepare(
          'UPDATE google_oauth SET access_token = ?, expires_at = ?, updated_at = ? WHERE id = 1'
        ).run(refreshed.access_token, refreshed.expires_at, Date.now())
        res = shouldUpdate
          ? await updateCalendarEvent(refreshed.access_token, calendarId, session.googleEventId!, event)
          : await createCalendarEvent(refreshed.access_token, calendarId, event)
      } catch {
        return { synced: false, error: 'Token refresh failed on retry' }
      }
    }

    // If PUT returned 404, the remote event was deleted — fall back to create
    if (shouldUpdate && res.status === 404) {
      res = await createCalendarEvent(tokens.access_token, calendarId, event)
    }

    if (res.status === 404) {
      // Calendar may have been deleted; clear cached ID and retry
      db.prepare('UPDATE google_oauth SET calendar_id = \'\' WHERE id = 1').run()
      try {
        calendarId = await getOrCreateSeshCalendar(tokens.access_token)
        db.prepare('UPDATE google_oauth SET calendar_id = ? WHERE id = 1').run(calendarId)
        res = await createCalendarEvent(tokens.access_token, calendarId, event)
      } catch (err) {
        return { synced: false, error: `Calendar recreation failed: ${err}` }
      }
    }

    if (!res.ok) {
      const text = await res.text()
      return { synced: false, error: `Calendar API error ${res.status}: ${text}` }
    }

    const result = await res.json()
    return { synced: true, eventId: result.id }
  } catch (err) {
    return { synced: false, error: String(err) }
  }
}

/**
 * Persist the calendar sync result back to the sessions table.
 * On success: stores event ID and marks synced.
 * On failure: marks unsynced but preserves existing google_event_id for retry.
 */
export function persistCalendarSyncResult(sessionId: string, result: SyncResult) {
  const db = getDb()
  if (result.synced && result.eventId) {
    db.prepare(`
      UPDATE sessions
      SET google_event_id = ?, is_synced = 1
      WHERE id = ?
    `).run(result.eventId, sessionId)
    return
  }
  db.prepare(`
    UPDATE sessions
    SET is_synced = 0
    WHERE id = ?
  `).run(sessionId)
}
