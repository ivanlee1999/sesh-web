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

    expect(screen.getByTestId('calendar-screen')).toHaveClass('w-full', 'min-w-0')
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

    expect(screen.getByTestId('insights-screen')).toHaveClass('w-full', 'min-w-0')
  })
})

describe('Settings task-source status', () => {
  /** Both providers render a row, so assertions must be scoped to one of them. */
  function rowFor(title: string): HTMLElement {
    const row = screen.getByText(title).closest('.sesh-row')
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

    await screen.findByText('Connected')
    expect(within(rowFor('Todoist')).getByRole('button', { name: 'Check' })).toBeTruthy()
  })

  it('offers to connect Things when nothing is configured', async () => {
    mockSettingsFetch(json({ configured: false }))

    render(<Settings />)

    await screen.findByText('Things 3')
    // Google Calendar shows the same words, so scope to the Things row.
    const row = within(rowFor('Things 3'))
    expect(await row.findByText('Not connected')).toBeTruthy()
    expect(row.getByRole('button', { name: 'Connect' })).toBeTruthy()
  })

  it('flags Things as unreachable when configured but the service is down', async () => {
    mockSettingsFetch(
      json({ configured: false }),
      json({ configured: true, reachable: false, source: 'app', url: 'http://things:8080', hasKey: false }),
    )

    render(<Settings />)

    expect(await screen.findByText(/Service unreachable/)).toBeTruthy()
  })

  it('offers to edit an existing Things connection', async () => {
    mockSettingsFetch(
      json({ configured: false }),
      json({ configured: true, reachable: true, source: 'app', url: 'http://things:8080', hasKey: true }),
    )

    render(<Settings />)

    await screen.findByText('Things 3')
    expect(within(rowFor('Things 3')).getByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('says so when Things is connected through the server environment', async () => {
    mockSettingsFetch(
      json({ configured: false }),
      json({ configured: true, reachable: true, source: 'env', url: 'http://env-things:8080', hasKey: false }),
    )

    render(<Settings />)

    expect(await screen.findByText('Connected via server config')).toBeTruthy()
  })

  it('saves a Things connection from the sheet without leaking the stored key', async () => {
    const puts: { url: string; body: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/auth/google/status')) return json({ connected: false })
      if (url.includes('/api/todoist/status')) return json({ configured: false })
      if (url.includes('/api/things/config') && init?.method === 'PUT') {
        puts.push({ url, body: JSON.parse(String(init.body)) })
        return json({ configured: true, source: 'app', url: 'http://things:8080', hasKey: false, reachable: true })
      }
      if (url.includes('/api/things/status')) return json({ configured: false })
      return json({})
    })

    render(<Settings />)

    fireEvent.click(await within(rowFor('Things 3')).findByRole('button', { name: 'Connect' }))
    const address = await screen.findByPlaceholderText('http://sesh-things-cloud:8080')
    fireEvent.change(address, { target: { value: 'things:8080' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))

    await screen.findByText(/Connected\./)
    // No apiKey field at all, so the server keeps whatever key it already had.
    expect(puts).toEqual([{ url: '/api/things/config', body: { url: 'things:8080' } }])
  })

  it('shows Todoist setup text when the server token is missing', async () => {
    mockSettingsFetch(json({ configured: false }))

    render(<Settings />)

    expect(await screen.findByText('Set TODOIST_API_TOKEN on the server to enable task sync.')).toBeTruthy()
  })

  it('shows Todoist auth-required state', async () => {
    mockSettingsFetch(json({ error: 'Missing or invalid session' }, 401))

    render(<Settings />)

    expect(await screen.findByText('Auth required. Sign in again to use Todoist.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('shows Todoist backend errors with status detail', async () => {
    mockSettingsFetch(json({ error: 'upstream unavailable' }, 503))

    render(<Settings />)

    expect(await screen.findByText(/Todoist status check failed \(503: upstream unavailable\)/)).toBeTruthy()
  })
})
