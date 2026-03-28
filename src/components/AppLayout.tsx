'use client'
import { useState } from 'react'
import Timer from './Timer'
import SessionLog from './SessionLog'
import Settings from './Settings'
import TabBar, { type AppTab } from './TabBar'

export default function AppLayout() {
  const [activeTab, setActiveTab] = useState<AppTab>('timer')

  return (
    <>
      <div className="app-shell">
        <div className="view-stack">
          <div style={{ display: activeTab === 'timer' ? 'block' : 'none' }}>
            <Timer />
          </div>
          <div style={{ display: activeTab === 'log' ? 'block' : 'none' }}>
            <SessionLog isVisible={activeTab === 'log'} />
          </div>
          <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
            <Settings />
          </div>
        </div>
      </div>

      {/* TabBar is OUTSIDE app-shell to ensure position:fixed works */}
      <TabBar activeTab={activeTab} onChange={setActiveTab} />
    </>
  )
}
