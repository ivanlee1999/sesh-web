'use client'
import { useEffect, useState } from 'react'
import { App } from 'konsta/react'
import { useSettings } from '@/context/SettingsContext'
import { ensurePushSubscription } from '@/lib/push-client'
import Timer from './Timer'
import History from './History'
import Analytics from './Analytics'
import Categories from './Categories'
import Settings from './Settings'
import TabBar, { type AppTab } from './TabBar'

export default function AppLayout() {
  const [activeTab, setActiveTab] = useState<AppTab>('timer')
  const { settings } = useSettings()

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(registration => {
        void registration.update().catch(() => {})
        if ('Notification' in window && Notification.permission === 'granted') {
          void ensurePushSubscription().catch(() => {})
        }
      })
      .catch(err => {
        console.error('[pwa] failed to register service worker:', err)
      })
  }, [])

  return (
    <App theme="ios" dark={settings.darkMode} safeAreas>
      <div className="app-shell">
        <div className="view-stack">
          <div style={{ display: activeTab === 'timer' ? 'block' : 'none' }}>
            <Timer />
          </div>
          <div style={{ display: activeTab === 'history' ? 'block' : 'none' }}>
            <History />
          </div>
          <div style={{ display: activeTab === 'analytics' ? 'block' : 'none' }}>
            <Analytics />
          </div>
          <div style={{ display: activeTab === 'categories' ? 'block' : 'none' }}>
            <Categories />
          </div>
          <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
            <Settings />
          </div>
        </div>
      </div>

      {/* TabBar is OUTSIDE app-shell to ensure position:fixed works */}
      <TabBar activeTab={activeTab} onChange={setActiveTab} />
    </App>
  )
}
