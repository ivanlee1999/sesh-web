import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Minimal stand-in for the sessions table. Only the two statements the route
 * issues are recognised, so a change in its SQL surfaces as a failure here
 * rather than passing silently.
 */
interface Row {
  id: string
  intention: string
  category: string
  type: string
  target_ms: number
  actual_ms: number
  overflow_ms: number
  started_at: number
  ended_at: number
  notes: string
  rating: number
  todoist_task_id: string | null
  google_event_id: string
  is_synced: number
}

const rows = new Map<string, Row>()

vi.mock('@/lib/server-db', () => ({
  getDb: () => ({
    prepare(sql: string) {
      const flat = sql.replace(/\s+/g, ' ').trim()
      if (flat.startsWith('INSERT INTO sessions')) {
        if (!flat.includes('ON CONFLICT(id) DO UPDATE')) {
          throw new Error('sessions POST must upsert, not ignore, an existing row')
        }
        return {
          run: (
            id: string, intention: string, category: string, type: string,
            targetMs: number, actualMs: number, overflowMs: number,
            startedAt: number, endedAt: number, notes: string, rating: number,
            todoistTaskId: string | null,
          ) => {
            const existing = rows.get(id)
            if (existing) {
              // Editable fields only — timings stay as first written.
              Object.assign(existing, { intention, category, notes, rating, todoist_task_id: todoistTaskId })
              return
            }
            rows.set(id, {
              id, intention, category, type,
              target_ms: targetMs, actual_ms: actualMs, overflow_ms: overflowMs,
              started_at: startedAt, ended_at: endedAt, notes, rating,
              todoist_task_id: todoistTaskId, google_event_id: '', is_synced: 0,
            })
          },
        }
      }
      if (flat.startsWith('SELECT * FROM sessions WHERE id = ?')) {
        return { get: (id: string) => rows.get(id) }
      }
      if (flat.startsWith('SELECT * FROM sessions ORDER BY')) {
        return { all: () => Array.from(rows.values()) }
      }
      throw new Error(`unexpected SQL: ${flat}`)
    },
  }),
}))

/** What the route hands to the calendar layer. */
interface SyncArgs {
  id: string
  intention: string
  category: string
  googleEventId: string
  isSynced: boolean
}

// The event id echoes the session id, so an assertion proves which session
// was synced rather than just that something was.
const syncSessionToGoogleCalendar = vi.fn(
  async (session: SyncArgs) => ({ synced: true, eventId: `evt-${session.id}` }),
)
const persisted: Array<{ id: string; result: unknown }> = []
const persistCalendarSyncResult = vi.fn((id: string, result: unknown) => {
  persisted.push({ id, result })
})

vi.mock('@/lib/google-calendar', () => ({
  syncSessionToGoogleCalendar: (session: SyncArgs) => syncSessionToGoogleCalendar(session),
  persistCalendarSyncResult: (id: string, result: unknown) => persistCalendarSyncResult(id, result),
}))

import { POST } from '../sessions/route'

const BASE = {
  type: 'focus',
  targetMs: 1_500_000,
  actualMs: 1_500_000,
  overflowMs: 0,
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_001_500_000,
  notes: '',
  rating: 0,
}

function post(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...BASE, ...body }),
  }))
}

beforeEach(() => {
  rows.clear()
  persisted.length = 0
  syncSessionToGoogleCalendar.mockClear()
  persistCalendarSyncResult.mockClear()
})

describe('POST /api/sessions', () => {
  it('stores a new session', async () => {
    await post({ id: 's1', intention: 'Write the memo', category: 'work' })
    expect(rows.get('s1')).toMatchObject({ intention: 'Write the memo', category: 'work' })
  })

  it('applies a topic edited after the session was already saved', async () => {
    // The background auto-completer gets there first, under the same id.
    await post({ id: 's1', intention: 'Old intention', category: 'work' })
    // Then the reflection screen saves the edited topic.
    await post({ id: 's1', intention: 'New intention', category: 'study', rating: 4 })

    expect(rows.get('s1')).toMatchObject({
      intention: 'New intention',
      category: 'study',
      rating: 4,
    })
  })

  it('keeps the original timings when a session is re-saved', async () => {
    await post({ id: 's1', intention: 'First', actualMs: 1_500_000 })
    await post({ id: 's1', intention: 'Second', actualMs: 999 })
    expect(rows.get('s1')).toMatchObject({ actual_ms: 1_500_000, intention: 'Second' })
  })

  it('updates the existing calendar event instead of creating a second one', async () => {
    await post({ id: 's1', intention: 'Old intention' })
    // First sync assigned an event id.
    rows.get('s1')!.google_event_id = 'evt-s1'
    rows.get('s1')!.is_synced = 1
    syncSessionToGoogleCalendar.mockClear()

    await post({ id: 's1', intention: 'New intention' })

    expect(syncSessionToGoogleCalendar).toHaveBeenCalledTimes(1)
    // Carrying the event id is what makes google-calendar PUT rather than POST.
    expect(syncSessionToGoogleCalendar.mock.calls[0][0]).toMatchObject({
      googleEventId: 'evt-s1',
      isSynced: true,
      intention: 'New intention',
    })
  })

  it('syncs the stored row, so the calendar never lags the database', async () => {
    await post({ id: 's1', intention: 'Only intention', category: 'study' })
    expect(syncSessionToGoogleCalendar.mock.calls[0][0]).toMatchObject({
      id: 's1',
      intention: 'Only intention',
      category: 'study',
    })
    expect(persisted).toEqual([{ id: 's1', result: { synced: true, eventId: 'evt-s1' } }])
  })
})
