'use client'
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '@/types'
import { mixHex } from '@/components/sesh-ui'

export const THEME_COLOR_LIGHT = '#F4F1EA'
export const THEME_COLOR_DARK = '#15120D'

interface SettingsContextType {
  settings: AppSettings
  updateSettings: (updates: Partial<AppSettings>) => void
}

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

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

  // Apply theme tokens and browser chrome color whenever settings change.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', settings.darkMode)
    root.dataset.theme = settings.darkMode ? 'dark' : 'light'
    root.style.colorScheme = settings.darkMode ? 'dark' : 'light'
    root.style.setProperty('--accent', settings.accentColor)
    root.style.setProperty(
      '--accent-soft',
      mixHex(settings.accentColor, settings.darkMode ? '#15120D' : '#F4F1EA', 0.16),
    )
    root.style.setProperty(
      '--accent-ink',
      mixHex(settings.accentColor, settings.darkMode ? '#F1ECE2' : '#211E18', settings.darkMode ? 0.82 : 0.74),
    )

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
  }, [settings.darkMode, settings.accentColor])

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
