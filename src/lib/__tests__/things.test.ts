import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listThingsTasks,
  listThingsView,
  verifyThings,
  type ThingsConnection,
} from '../things'

const CONN: ThingsConnection = { url: 'http://things-cloud:8080', apiKey: 'secret' }

describe('things client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses to call out without a URL', async () => {
    await expect(listThingsView({ url: '', apiKey: '' }, 'today')).rejects.toThrow('THINGS_NOT_CONFIGURED')
  })

  it('sends the bearer token and strips a trailing slash from the base URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await listThingsView({ ...CONN, url: 'http://things-cloud:8080/' }, 'today')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://things-cloud:8080/api/tasks/today')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
  })

  it('omits the bearer header when the sidecar has no API key', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await listThingsView({ ...CONN, apiKey: '' }, 'inbox')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('accepts both bare arrays and wrapped payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(
        url.endsWith('/today')
          ? JSON.stringify([{ uuid: 'a', title: 'Bare' }])
          : JSON.stringify({ tasks: [{ uuid: 'b', title: 'Wrapped' }] }),
        { status: 200 },
      )))

    expect(await listThingsView(CONN, 'today')).toEqual([{ uuid: 'a', title: 'Bare' }])
    expect(await listThingsView(CONN, 'inbox')).toEqual([{ uuid: 'b', title: 'Wrapped' }])
  })

  it('merges views and drops duplicates across them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(JSON.stringify(
        url.endsWith('/today')
          ? [{ uuid: 'a', title: 'A' }, { uuid: 'b', title: 'B' }]
          : [{ uuid: 'b', title: 'B again' }, { uuid: 'c', title: 'C' }],
      ), { status: 200 })))

    const tasks = await listThingsTasks(CONN, ['today', 'inbox'])
    expect(tasks.map(t => t.uuid)).toEqual(['a', 'b', 'c'])
  })

  it('keeps the other views when one fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/today')
        ? new Response('boom', { status: 500 })
        : new Response(JSON.stringify([{ uuid: 'c', title: 'C' }]), { status: 200 })))

    expect((await listThingsTasks(CONN, ['today', 'inbox'])).map(t => t.uuid)).toEqual(['c'])
  })

  it('reports verification failure rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    expect(await verifyThings(CONN)).toBe(false)
  })

  it('uses the connection it is given, not an ambient one', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await listThingsView({ url: 'https://elsewhere.example', apiKey: 'other' }, 'today')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://elsewhere.example/api/tasks/today')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer other')
  })
})
