'use client'
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '@/types'

export const THEME_COLOR_LIGHT = '#FFFFFF'
export const THEME_COLOR_DARK = '#1c1c1e'

function getStoredSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const stored = localStorage.getItem('sesh-settings')
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
    }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS
}

interface SettingsContextType {
  settings: AppSettings
  updateSettings: (updates: Partial<AppSettings>) => void
}

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(getStoredSettings)

  // Load settings: server first, then merge with localStorage
  useEffect(() => {
    async function load() {
      let serverSettings: Partial<AppSettings> = {}
      try {
        const res = await fetch('/api/settings')
        if (res.ok) {
          serverSettings = await res.json()
        }
      } catch { /* offline fallback */ }

      const stored = localStorage.getItem('sesh-settings')
      let localSettings: Partial<AppSettings> = {}
      if (stored) {
        try { localSettings = JSON.parse(stored) } catch { /* ignore */ }
      }

      // Server takes priority over local
      const merged = { ...DEFAULT_SETTINGS, ...localSettings, ...serverSettings }
      setSettings(merged)
      localStorage.setItem('sesh-settings', JSON.stringify(merged))
    }
    load()
  }, [])

  // Apply dark mode class, color-scheme, and browser chrome color whenever settings change
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', settings.darkMode)
    root.style.colorScheme = settings.darkMode ? 'dark' : 'light'

    // Update theme-color meta tag for browser/PWA chrome
    const themeColor = settings.darkMode ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
    if (meta) {
      meta.content = themeColor
    } else {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      meta.content = themeColor
      document.head.appendChild(meta)
    }
  }, [settings.darkMode])

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates }
      localStorage.setItem('sesh-settings', JSON.stringify(next))
      // Sync to server (fire-and-forget)
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {})
      return next
    })
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
