'use client'
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '@/types'

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
