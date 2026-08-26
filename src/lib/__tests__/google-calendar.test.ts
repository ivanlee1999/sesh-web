import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbState = {
  settingsValue: 'true',
  /** name -> label, as the categories table holds it. */
  categories: {} as Record<string, string>,
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
      get: (...params: unknown[]) => {
        if (sql.includes("FROM settings WHERE key = 'calendarSync'")) {
          return { value: dbState.settingsValue }
        }
        if (sql.includes('FROM google_oauth WHERE id = 1')) {
          return dbState.oauth
        }
        if (sql.includes('FROM categories WHERE name = ?')) {
          const label = dbState.categories[String(params[0])]
          return label ? { label } : undefined
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
    dbState.categories = { deep: 'Deep Work' }
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

  describe('event title', () => {
    /** Sync one focus session and hand back the event that was sent. */
    async function syncedEvent(overrides: Record<string, unknown> = {}) {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'event-1' }) })
      const startedAt = Date.parse('2026-06-18T17:00:00.000Z')
      await syncSessionToGoogleCalendar({
        id: 'session-1',
        intention: 'Draft the memo',
        category: 'deep',
        type: 'focus',
        startedAt,
        endedAt: startedAt + 25 * 60 * 1000,
        targetMs: 25 * 60 * 1000,
        actualMs: 25 * 60 * 1000,
        overflowMs: 0,
        notes: '',
        ...overrides,
      })
      const [, request] = fetchMock.mock.calls[0]
      return JSON.parse(String(request?.body))
    }

    it('leads the title with the category', async () => {
      expect((await syncedEvent()).summary).toBe('Deep Work · Draft the memo')
    })

    it('uses the label people chose, not the stored slug', async () => {
      // The session records the category name; "Deep Work" only exists in the
      // categories table, and titling the event "Deep" would be the bug.
      const event = await syncedEvent()
      expect(event.summary).toContain('Deep Work')
      expect(event.description).toContain('Category: Deep Work')
    })

    it('still names the category when a session has no intention', async () => {
      expect((await syncedEvent({ intention: '' })).summary).toBe('Deep Work · Focus')
      expect((await syncedEvent({ intention: '   ' })).summary).toBe('Deep Work · Focus')
    })

    it('humanises the slug when the category has since been deleted', async () => {
      dbState.categories = {}
      expect((await syncedEvent({ category: 'side-project' })).summary).toBe('Side Project · Draft the memo')
    })

    it('falls back to the intention alone when a session carries no category', async () => {
      expect((await syncedEvent({ category: '' })).summary).toBe('Draft the memo')
    })
  })
})
