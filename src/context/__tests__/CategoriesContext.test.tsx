import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { CategoriesProvider, useCategories } from '../CategoriesContext'
import type { ReactNode } from 'react'

// Mock local-store
const mockCacheCategories = vi.fn()
const mockGetCachedCategories = vi.fn<[], unknown[] | null>(() => null)

vi.mock('@/lib/local-store', () => ({
  cacheCategories: (...args: unknown[]) => mockCacheCategories(...args),
  getCachedCategories: () => mockGetCachedCategories(),
}))

// Mock fetch
const mockFetch = vi.fn()

beforeEach(() => {
  mockCacheCategories.mockClear()
  mockGetCachedCategories.mockReturnValue(null)
  mockFetch.mockClear()
  global.fetch = mockFetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <CategoriesProvider>{children}</CategoriesProvider>
)

const sampleCategories = [
  { id: '1', name: 'deep-work', label: 'Deep Work', color: '#3b82f6', sortOrder: 0, isDefault: true },
  { id: '2', name: 'reading', label: 'Reading', color: '#10b981', sortOrder: 1, isDefault: false },
]

describe('CategoriesContext', () => {
  it('provides categories from API fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleCategories,
    })

    const { result } = renderHook(() => useCategories(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.categories).toEqual(sampleCategories)
    expect(result.current.error).toBeNull()
    expect(mockCacheCategories).toHaveBeenCalledWith(sampleCategories)
  })

  it('builds byName lookup from categories', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleCategories,
    })

    const { result } = renderHook(() => useCategories(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.byName['deep-work']).toEqual(sampleCategories[0])
    expect(result.current.byName['reading']).toEqual(sampleCategories[1])
  })

  it('falls back to cached categories on fetch failure', async () => {
    mockGetCachedCategories.mockReturnValue(sampleCategories)
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useCategories(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.categories).toEqual(sampleCategories)
    expect(result.current.error).toBeNull()
  })

  it('sets error when fetch fails and no cache available', async () => {
    mockGetCachedCategories.mockReturnValue(null)
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useCategories(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Failed to load categories')
  })

  it('seeds from cached categories immediately (before fetch completes)', () => {
    mockGetCachedCategories.mockReturnValue(sampleCategories)
    // Fetch never resolves
    mockFetch.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useCategories(), { wrapper })

    // Should immediately have cached data before fetch completes
    expect(result.current.categories).toEqual(sampleCategories)
    expect(result.current.loading).toBe(true) // still loading
  })

  it('refresh() refetches and updates state', async () => {
    const initial = [sampleCategories[0]]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => initial,
    })

    const { result } = renderHook(() => useCategories(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.categories).toEqual(initial)

    // Now refresh with updated data
    const updated = sampleCategories
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => updated,
    })

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.categories).toEqual(updated)
  })

  it('createCategory calls POST and refreshes', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => sampleCategories }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '3', name: 'meditation', label: 'Meditation' }) }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => [...sampleCategories, { id: '3', name: 'meditation', label: 'Meditation', color: '#8b5cf6', sortOrder: 2, isDefault: false }] }) // refresh

    const { result } = renderHook(() => useCategories(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const createResult = await act(async () => {
      return result.current.createCategory({ label: 'Meditation', color: '#8b5cf6' })
    })

    expect(createResult.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('/api/categories', expect.objectContaining({ method: 'POST' }))
  })

  it('deleteCategory calls DELETE and refreshes', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => sampleCategories }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // DELETE
      .mockResolvedValueOnce({ ok: true, json: async () => [sampleCategories[0]] }) // refresh

    const { result } = renderHook(() => useCategories(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const deleteResult = await act(async () => {
      return result.current.deleteCategory('2')
    })

    expect(deleteResult.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('/api/categories/2', expect.objectContaining({ method: 'DELETE' }))
  })

  it('returns error from failed createCategory', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => sampleCategories }) // initial fetch
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'A category with this name already exists' }) }) // POST fails

    const { result } = renderHook(() => useCategories(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const createResult = await act(async () => {
      return result.current.createCategory({ label: 'Deep Work', color: '#3b82f6' })
    })

    expect(createResult.ok).toBe(false)
    expect(createResult.error).toBe('A category with this name already exists')
  })
})
