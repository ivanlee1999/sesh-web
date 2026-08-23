import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

async function load() {
  vi.resetModules()
  return import('../things')
}

describe('things client', () => {
  beforeEach(() => {
    process.env.THINGS_API_URL = 'http://things-cloud:8080'
    process.env.THINGS_API_KEY = 'secret'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  it('is unconfigured without a URL', async () => {
    delete process.env.THINGS_API_URL
    const { isThingsConfigured } = await load()
    expect(isThingsConfigured()).toBe(false)
  })

  it('sends the bearer token and strips a trailing slash from the base URL', async () => {
    process.env.THINGS_API_URL = 'http://things-cloud:8080/'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { listThingsView } = await load()
    await listThingsView('today')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://things-cloud:8080/api/tasks/today')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
  })

  it('omits the bearer header when the sidecar has no API key', async () => {
    delete process.env.THINGS_API_KEY
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { listThingsView } = await load()
    await listThingsView('inbox')

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

    const { listThingsView } = await load()
    expect(await listThingsView('today')).toEqual([{ uuid: 'a', title: 'Bare' }])
    expect(await listThingsView('inbox')).toEqual([{ uuid: 'b', title: 'Wrapped' }])
  })

  it('merges views and drops duplicates across them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(JSON.stringify(
        url.endsWith('/today')
          ? [{ uuid: 'a', title: 'A' }, { uuid: 'b', title: 'B' }]
          : [{ uuid: 'b', title: 'B again' }, { uuid: 'c', title: 'C' }],
      ), { status: 200 })))

    const { listThingsTasks } = await load()
    const tasks = await listThingsTasks(['today', 'inbox'])
    expect(tasks.map(t => t.uuid)).toEqual(['a', 'b', 'c'])
  })

  it('keeps the other views when one fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/today')
        ? new Response('boom', { status: 500 })
        : new Response(JSON.stringify([{ uuid: 'c', title: 'C' }]), { status: 200 })))

    const { listThingsTasks } = await load()
    expect((await listThingsTasks(['today', 'inbox'])).map(t => t.uuid)).toEqual(['c'])
  })

  it('reports verification failure rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    const { verifyThings } = await load()
    expect(await verifyThings()).toBe(false)
  })
})
