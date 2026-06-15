import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
      soundEnabled: false,
      calendarSync: false,
      darkMode: false,
      keepScreenAwake: false,
      autoStartBreak: false,
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

describe('Settings Todoist status', () => {
  function mockSettingsFetch(todoistResponse: Response) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/auth/google/status')) return json({ connected: false })
      if (url.includes('/api/todoist/status')) return todoistResponse.clone()
      if (url.includes('/api/sessions')) return json([])
      if (url.includes('/api/analytics')) return json({ streak: 0, todayMs: 0 })
      return json({})
    })
  }

  it('shows Todoist connected status with an active check action', async () => {
    mockSettingsFetch(json({ configured: true }))

    render(<Settings />)

    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy()
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
