import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbState = {
  settingsValue: 'true',
  oauth: {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: Date.now() + 60 * 60 * 1000,
    calendar_id: 'sesh-calendar-id',
  },
}

vi.mock('@/lib/server-db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: () => {
        if (sql.includes("FROM settings WHERE key = 'calendarSync'")) {
          return { value: dbState.settingsValue }
        }
        if (sql.includes('FROM google_oauth WHERE id = 1')) {
          return dbState.oauth
        }
        return undefined
      },
      run: () => ({ changes: 1 }),
    }),
  }),
}))

import { syncSessionToGoogleCalendar } from '@/lib/google-calendar'

describe('syncSessionToGoogleCalendar', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    dbState.settingsValue = 'true'
    dbState.oauth = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + 60 * 60 * 1000,
      calendar_id: 'sesh-calendar-id',
    }
  })

  it('uses actual session duration to set the calendar event end time when overtime extends past endedAt', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'event-123' }),
    })

    const startedAt = Date.parse('2026-06-18T17:00:00.000Z')
    const persistedEndedAt = startedAt + 25 * 60 * 1000
    const actualMs = 35 * 60 * 1000

    const result = await syncSessionToGoogleCalendar({
      id: 'session-1',
      intention: 'Deep work',
      category: 'development',
      type: 'focus',
      startedAt,
      endedAt: persistedEndedAt,
      targetMs: 25 * 60 * 1000,
      actualMs,
      overflowMs: 10 * 60 * 1000,
      notes: '',
    })

    expect(result).toEqual({ synced: true, eventId: 'event-123' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, request] = fetchMock.mock.calls[0]
    const event = JSON.parse(String(request?.body))
    expect(event.start.dateTime).toBe(new Date(startedAt).toISOString())
    expect(event.end.dateTime).toBe(new Date(startedAt + actualMs).toISOString())
  })
})
