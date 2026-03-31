import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SettingsProvider, useSettings } from '../SettingsContext'
import type { ReactNode } from 'react'

// Mock fetch
const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockClear()
  global.fetch = mockFetch
  // Default: server settings returns 200 with empty object
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  // Clear localStorage
  localStorage.clear()
  // Reset document state
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
)

describe('SettingsContext – theme synchronization', () => {
  it('default light mode does not add .dark class', async () => {
    renderHook(() => useSettings(), { wrapper })

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })

  it('default light mode sets color-scheme to light', async () => {
    renderHook(() => useSettings(), { wrapper })

    await waitFor(() => {
      expect(document.documentElement.style.colorScheme).toBe('light')
    })
  })

  it('toggling dark mode adds .dark class and updates color-scheme', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper })

    await waitFor(() => {
      expect(document.documentElement.style.colorScheme).toBe('light')
    })

    act(() => {
      result.current.updateSettings({ darkMode: true })
    })

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })
  })

  it('toggling dark mode off removes .dark class and sets color-scheme to light', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper })

    act(() => {
      result.current.updateSettings({ darkMode: true })
    })

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    act(() => {
      result.current.updateSettings({ darkMode: false })
    })

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(document.documentElement.style.colorScheme).toBe('light')
    })
  })

  it('loads stored dark mode from localStorage', async () => {
    localStorage.setItem('sesh-settings', JSON.stringify({ darkMode: true }))

    renderHook(() => useSettings(), { wrapper })

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })
  })

  it('server settings override local settings', async () => {
    localStorage.setItem('sesh-settings', JSON.stringify({ darkMode: true }))
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ darkMode: false }),
    })

    renderHook(() => useSettings(), { wrapper })

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(document.documentElement.style.colorScheme).toBe('light')
    })
  })
})
