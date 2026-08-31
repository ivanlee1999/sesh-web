import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  ThingsAuthError,
  ThingsCloudError,
  ACTION_CREATED,
  commitItem,
  completedFields,
  decodeNote,
  encodeNote,
  fetchItems,
  noteChecksum,
  verifyAccount,
} from '../things-cloud'

const CREDS = { email: 'me@example.com', password: 'hunter2' }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifyAccount', () => {
  it('authenticates with the Password scheme and returns the history key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ email: 'me@example.com', 'history-key': 'hist-1' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await verifyAccount(CREDS)).toEqual({ email: 'me@example.com', historyKey: 'hist-1' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://cloud.culturedcode.com/version/1/account/me%40example.com')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Password hunter2')
    // Things rejects requests without its client-info header.
    expect(headers['Things-Client-Info']).toBeTruthy()
  })

  it('escapes an email that would otherwise break the path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ 'history-key': 'h' }))
    vi.stubGlobal('fetch', fetchMock)

    await verifyAccount({ email: 'a+b/c@example.com', password: 'x' })

    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('a%2Bb%2Fc%40example.com')
  })

  it('reports bad credentials distinctly from an outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })))
    await expect(verifyAccount(CREDS)).rejects.toThrow(ThingsAuthError)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(verifyAccount(CREDS)).rejects.toThrow(ThingsCloudError)
  })

  it('refuses an account with no sync stream rather than returning a blank key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ email: 'me@example.com' })))
    await expect(verifyAccount(CREDS)).rejects.toThrow(ThingsCloudError)
  })
})

describe('fetchItems', () => {
  it('flattens the uuid-keyed batches the server sends', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      items: [
        { 'uuid-a': { e: 'Task6', t: 0, p: { tt: 'First' } } },
        { 'uuid-b': { e: 'Task6', t: 1, p: { ss: 3 } } },
      ],
      'current-item-index': 2,
    })))

    const batch = await fetchItems(CREDS, 'hist-1', 0)
    expect(batch.currentItemIndex).toBe(2)
    expect(batch.items).toEqual([
      { uuid: 'uuid-a', kind: 'Task6', action: 0, payload: { tt: 'First' } },
      { uuid: 'uuid-b', kind: 'Task6', action: 1, payload: { ss: 3 } },
    ])
  })

  it('asks for items from the requested index', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [], 'current-item-index': 42 }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchItems(CREDS, 'hist-1', 42)

    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://cloud.culturedcode.com/version/1/history/hist-1/items?start-index=42')
  })
})

describe('notes', () => {
  it('checksums with CRC-32, which is what Things validates against', () => {
    // Known CRC-32/IEEE value for "123456789".
    expect(noteChecksum('123456789')).toBe(0xCBF43926)
    expect(noteChecksum('')).toBe(0)
  })

  it('encodes a note in the shape Things.app writes', () => {
    expect(encodeNote('hello')).toEqual({ _t: 'tx', ch: noteChecksum('hello'), v: 'hello', t: 1 })
  })

  it('reads legacy XML notes and full-text notes alike', () => {
    expect(decodeNote('<note xml:space="preserve">old style</note>', '')).toBe('old style')
    expect(decodeNote({ t: 1, v: 'new style' }, '')).toBe('new style')
  })

  it('leaves the note alone when it cannot resolve a delta', () => {
    // A patch note needs the prior text to apply; keeping what we have beats
    // guessing and overwriting somebody's note with a fragment.
    expect(decodeNote({ t: 2, ps: [] }, 'existing')).toBe('existing')
    expect(decodeNote(undefined, 'existing')).toBe('existing')
  })
})

describe('commitItem', () => {
  it('posts one keyed change with the headers Things expects', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ 'server-head-index': 51 }))
    vi.stubGlobal('fetch', fetchMock)

    const head = await commitItem(CREDS, 'hist-1', 50, 'task-uuid', 'Task6', { ss: 3 })
    expect(head).toBe(51)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/version/1/history/hist-1/commit?ancestor-index=50')
    expect(JSON.parse(String(init.body))).toEqual({
      'task-uuid': { t: 1, e: 'Task6', p: { ss: 3 } },
    })
    const headers = init.headers as Record<string, string>
    expect(headers.Schema).toBe('301')
    expect(headers['App-Id']).toBe('com.culturedcode.ThingsMac')
  })

  it('commits a create under action 0, not the modify every other write uses', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ 'server-head-index': 60 }))
    vi.stubGlobal('fetch', fetchMock)

    await commitItem(CREDS, 'hist-1', 59, 'new-uuid', 'Task6', { tt: 'New' }, ACTION_CREATED)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // t:0 is create. Sending t:1 for a new item asks Things to patch something
    // that does not exist yet, which lands as nothing at all.
    expect(JSON.parse(String(init.body))).toEqual({
      'new-uuid': { t: 0, e: 'Task6', p: { tt: 'New' } },
    })
  })
})

describe('completedFields', () => {
  it('marks the task done and stamps when', () => {
    const fields = completedFields()
    expect(fields.ss).toBe(3)
    expect(fields.sp).toBeGreaterThan(1_600_000_000)
    // Seconds, not milliseconds — the wire format is a unix float.
    expect(fields.sp).toBeLessThan(10_000_000_000)
  })
})
