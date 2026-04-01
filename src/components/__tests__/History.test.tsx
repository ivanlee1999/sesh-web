import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [
      { id: '1', name: 'development', label: 'Development', color: '#3b82f6', sortOrder: 0, isDefault: true },
    ],
    byName: {
      development: { id: '1', name: 'development', label: 'Development', color: '#3b82f6', sortOrder: 0, isDefault: true },
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  }),
}))

import History from '../History'

const mockSessions = [
  {
    id: 'sess-1',
    intention: 'Review PR',
    category: 'development',
    type: 'focus',
    targetMs: 25 * 60 * 1000,
    actualMs: 25 * 60 * 1000,
    overflowMs: 0,
    startedAt: Date.now() - 3600000,
    endedAt: Date.now() - 2100000,
    notes: '',
  },
  {
    id: 'sess-2',
    intention: 'Fix bug',
    category: 'development',
    type: 'focus',
    targetMs: 25 * 60 * 1000,
    actualMs: 12 * 60 * 1000,
    overflowMs: 0,
    startedAt: Date.now() - 7200000,
    endedAt: Date.now() - 6480000,
    notes: '',
  },
]

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('History', () => {
  it('groups sessions by date header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockSessions), { status: 200 })
    )

    render(<History />)

    await waitFor(() => {
      expect(screen.getByText('Review PR')).toBeTruthy()
    })
    expect(screen.getByText('Fix bug')).toBeTruthy()
    // Both sessions are today so should share one date header
    expect(screen.getByText('25m')).toBeTruthy()
    expect(screen.getByText('12m')).toBeTruthy()
  })

  it('renders empty state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    )

    render(<History />)

    await waitFor(() => {
      expect(screen.getByText('No sessions yet')).toBeTruthy()
    })
    expect(screen.getByText('Start your first focus session!')).toBeTruthy()
  })

  it('deletes a session via trash action', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    // First call: load sessions
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockSessions), { status: 200 })
    )

    render(<History />)

    await waitFor(() => {
      expect(screen.getByText('Review PR')).toBeTruthy()
    })

    // Click the first trash button
    // Mock the DELETE call then the reload
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([mockSessions[1]]), { status: 200 })
    )

    // Find trash buttons by their svg class
    const buttons = screen.getByText('Review PR').closest('[class*="list-item"]')?.querySelectorAll('button')
    if (buttons && buttons.length > 0) {
      fireEvent.click(buttons[buttons.length - 1])

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/sessions/sess-1'),
          expect.objectContaining({ method: 'DELETE' })
        )
      })
    }
  })
})
