'use client'
import { useState } from 'react'
import { App } from 'konsta/react'
import Timer from './Timer'
import History from './History'
import Analytics from './Analytics'
import Categories from './Categories'
import Settings from './Settings'
import TabBar, { type AppTab } from './TabBar'
import { useSettings } from '@/context/SettingsContext'

export default function AppLayout() {
  const [activeTab, setActiveTab] = useState<AppTab>('timer')
  const { settings } = useSettings()

  // Theme is settings-driven only; system preference must not drive Konsta
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
