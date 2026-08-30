import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import Calendar from '../Calendar'
import Analytics from '../Analytics'
import Settings from '../Settings'

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [
      { id: '1', name: 'work', label: 'Work', color: '#3b82f6', sortOrder: 0, isDefault: true },
    ],
    byName: {
      work: { id: '1', name: 'work', label: 'Work', color: '#3b82f6', sortOrder: 0, isDefault: true },
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  }),
}))

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      focusDuration: 25,
      breakDuration: 5,
      longBreakDuration: 15,
      sessionsBeforeLongBreak: 4,
      soundEnabled: false,
      calendarSync: false,
      darkMode: false,
      keepScreenAwake: false,
      autoStartBreak: false,
      autoStartFocus: false,
      todoistAutoComplete: true,
      accentColor: '#BE6E45',
    },
    updateSettings: vi.fn(),
  }),
}))

vi.mock('@/lib/push-client', () => ({
  clearPushSubscriptionConfirmed: vi.fn(),
  ensurePushSubscription: vi.fn(),
  isPushSupported: () => false,
}))

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('mobile tab layout shells', () => {
  it('keeps Calendar full-width and reports backend session errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'DB error' }, 500))

    render(<Calendar />)

    expect(screen.getByTestId('calendar-screen')).toHaveClass('md-screen', 'md-screen-col')
    expect(await screen.findByText(/Failed to load sessions \(500: DB error\)/)).toBeTruthy()
  })

  it('keeps Insights full-width', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/analytics')) {
        return json({ todayMs: 0, todayCount: 0, streak: 0, days: [] })
      }
      return json([])
    })

    render(<Analytics />)

    expect(screen.getByTestId('insights-screen')).toHaveClass('md-screen', 'md-screen-col')
  })
})

describe('Settings task-source status', () => {
  /** Settings is paged; the provider rows are behind the Sources tab. */
  async function openSources() {
    fireEvent.click(await screen.findByRole('button', { name: 'Sources' }))
  }

  /** Both providers render a row, so assertions must be scoped to one of them. */
  function rowFor(title: string): HTMLElement {
    const row = screen.getByText(title).parentElement?.parentElement
    if (!row) throw new Error(`No settings row found for "${title}"`)
    return row as HTMLElement
  }

  function mockSettingsFetch(todoistResponse: Response, thingsResponse = json({ configured: false })) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/auth/google/status')) return json({ connected: false })
      if (url.includes('/api/todoist/status')) return todoistResponse.clone()
      if (url.includes('/api/things/status')) return thingsResponse.clone()
      if (url.includes('/api/sessions')) return json([])
      if (url.includes('/api/analytics')) return json({ streak: 0, todayMs: 0 })
      return json({})
    })
  }

  it('shows Todoist connected status with an active check action', async () => {
    mockSettingsFetch(json({ configured: true }))

    render(<Settings />)
    await openSources()

    await screen.findByText('Connected')
    expect(within(rowFor('Todoist')).getByRole('button', { name: 'On' })).toBeTruthy()
  })

  it('offers to connect Things when nothing is configured', async () => {
    mockSettingsFetch(json({ configured: false }))

    render(<Settings />)
    await openSources()

    await screen.findByText('Things 3')
    // Google Calendar shows the same words, so scope to the Things row.
    const row = within(rowFor('Things 3'))
    expect(await row.findByText('Not connected')).toBeTruthy()
    expect(row.getByRole('button', { name: 'Manage' })).toBeTruthy()
  })

  it('flags Things as unreachable when configured but the service is down', async () => {
    mockSettingsFetch(
      json({ configured: false }),
      json({ configured: true, reachable: false, mode: 'sidecar', url: 'http://things:8080', hasKey: false }),
    )

    render(<Settings />)
    await openSources()

    expect(await screen.findByText(/Service unreachable/)).toBeTruthy()
  })

  it('names the connected Things account', async () => {
    mockSettingsFetch(
      json({ configured: false }),
      json({ configured: true, reachable: true, mode: 'cloud', email: 'me@example.com', url: '', hasKey: true }),
    )

    render(<Settings />)
    await openSources()

    expect(await screen.findByText('Connected as me@example.com')).toBeTruthy()
  })

  it('offers to edit an existing Things connection', async () => {
    mockSettingsFetch(
      json({ configured: false }),
      json({ configured: true, reachable: true, mode: 'sidecar', url: 'http://things:8080', hasKey: true }),
    )

    render(<Settings />)
    await openSources()

    await screen.findByText('Things 3')
    expect(within(rowFor('Things 3')).getByRole('button', { name: 'Manage' })).toBeTruthy()
  })

  it('says so when Things is connected through the server environment', async () => {
    mockSettingsFetch(
      json({ configured: false }),
      json({ configured: true, reachable: true, mode: 'env', url: 'http://env-things:8080', hasKey: false }),
    )

    render(<Settings />)
    await openSources()

    expect(await screen.findByText('Connected via server config')).toBeTruthy()
  })

  function mockThingsConfigPut(puts: unknown[], response: Record<string, unknown>) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/auth/google/status')) return json({ connected: false })
      if (url.includes('/api/todoist/status')) return json({ configured: false })
      if (url.includes('/api/things/config') && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)))
        return json(response)
      }
      if (url.includes('/api/things/status')) return json({ configured: false })
      return json({})
    })
  }

  it('signs in to Things with an email and password', async () => {
    const puts: unknown[] = []
    mockThingsConfigPut(puts, {
      configured: true, mode: 'cloud', email: 'me@example.com', url: '', hasKey: true, reachable: true,
    })

    render(<Settings />)
    await openSources()

    fireEvent.click(await within(rowFor('Things 3')).findByRole('button', { name: 'Manage' }))
    fireEvent.change(await screen.findByPlaceholderText('you@example.com'), { target: { value: 'me@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Your Things Cloud password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await screen.findByText(/Connected\./)
    expect(puts).toEqual([{ email: 'me@example.com', password: 'hunter2' }])
  })

  it('still saves a companion service through the advanced form', async () => {
    const puts: unknown[] = []
    mockThingsConfigPut(puts, {
      configured: true, mode: 'sidecar', email: '', url: 'http://things:8080', hasKey: false, reachable: true,
    })

    render(<Settings />)
    await openSources()

    fireEvent.click(await within(rowFor('Things 3')).findByRole('button', { name: 'Manage' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use a companion service instead' }))
    const address = await screen.findByPlaceholderText('http://sesh-things-cloud:8080')
    fireEvent.change(address, { target: { value: 'things:8080' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))

    await screen.findByText(/Connected\./)
    // No apiKey field at all, so the server keeps whatever key it already had.
    expect(puts).toEqual([{ url: 'things:8080' }])
  })

  it('says when the saved Things password stopped working', async () => {
    mockSettingsFetch(
      json({ configured: false }),
      json({ configured: true, mode: 'cloud', email: 'me@example.com', reachable: false, authFailed: true }),
    )

    render(<Settings />)
    await openSources()

    expect(await screen.findByText(/rejected the saved password/)).toBeTruthy()
  })

  it('shows Todoist setup text when the server token is missing', async () => {
    mockSettingsFetch(json({ configured: false }))

    render(<Settings />)
    await openSources()

    expect(await screen.findByText('Set TODOIST_API_TOKEN on the server to enable task sync.')).toBeTruthy()
  })

  it('shows Todoist auth-required state', async () => {
    mockSettingsFetch(json({ error: 'Missing or invalid session' }, 401))

    render(<Settings />)
    await openSources()

    expect(await screen.findByText('Auth required. Sign in again to use Todoist.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('shows Todoist backend errors with status detail', async () => {
    mockSettingsFetch(json({ error: 'upstream unavailable' }, 503))

    render(<Settings />)
    await openSources()

    expect(await screen.findByText(/Todoist status check failed \(503: upstream unavailable\)/)).toBeTruthy()
  })
})
