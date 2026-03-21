'use client'
import { useState, useEffect } from 'react'
import Timer from '@/components/Timer'
import Analytics from '@/components/Analytics'
import History from '@/components/History'
import Settings from '@/components/Settings'
import NavBar from '@/components/NavBar'
import { SettingsProvider } from '@/context/SettingsContext'

export type Tab = 'timer' | 'analytics' | 'history' | 'settings'

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('timer')

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  return (
    <SettingsProvider>
      <div className="flex flex-col min-h-screen max-w-2xl mx-auto">
        <main className="flex-1 overflow-auto pb-20 md:pb-4 md:pt-4">
          {activeTab === 'timer' && <Timer />}
          {activeTab === 'analytics' && <Analytics />}
          {activeTab === 'history' && <History />}
          {activeTab === 'settings' && <Settings />}
        </main>
        <NavBar activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>
    </SettingsProvider>
  )
}
