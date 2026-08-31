'use client'
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '@/types'
import { applyThemeColor } from '@/lib/accent'

// Re-exported from where the chrome is now decided, so the older imports and
// the tests around them keep resolving to one definition rather than a copy.
export { THEME_COLOR_LIGHT, THEME_COLOR_DARK } from '@/lib/accent'

interface SettingsContextType {
  settings: AppSettings
  /**
   * Whether the stored settings have arrived yet. Until they have, `settings`
   * is only the defaults — screens that act on a preference (which task
   * providers to query, say) must wait, or they briefly do the opposite of
   * what the person asked for.
   */
  loaded: boolean
  updateSettings: (updates: Partial<AppSettings>) => void
}

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  updateSettings: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

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
      setLoaded(true)
      localStorage.setItem('sesh-settings', JSON.stringify(merged))
    }
    load()
  }, [])

  // Apply theme tokens and browser chrome color whenever settings change.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', settings.darkMode)
    root.dataset.theme = settings.darkMode ? 'dark' : 'light'

    /*
     * A running session is dark whatever the interface preference, and this
     * effect belongs to a provider — so it runs *after* the child effect that
     * sets the focus flag, and would otherwise reset the chrome to light the
     * next time any setting changed mid-session. Reading the flag back off the
     * root keeps the two writers agreeing on one answer.
     */
    const inFocusMode = root.dataset.focusmode === 'true'
    const dark = settings.darkMode || inFocusMode
    root.style.colorScheme = dark ? 'dark' : 'light'

    // The chrome takes the ground the page is standing on rather than a
    // constant per mode: a running session tints the ground with its
    // category, and the strip behind the status bar has to agree with it.
    applyThemeColor(root, dark)
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
    <SettingsContext.Provider value={{ settings, loaded, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
