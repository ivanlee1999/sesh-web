'use client'
import { useEffect, useState } from 'react'
import { App } from 'konsta/react'
import { useSettings } from '@/context/SettingsContext'
import { ensurePushSubscription } from '@/lib/push-client'
import Timer from './Timer'
import Tasks, { type PendingFocus } from './Tasks'
import Calendar from './Calendar'
import Analytics from './Analytics'
import Settings from './Settings'
import Onboarding from './Onboarding'
import TabBar, { type AppTab } from './TabBar'

const ONBOARDED_KEY = 'sesh:onboarded'

export default function AppLayout() {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTab>('timer')
  const [immersive, setImmersive] = useState(false)
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null)
  const [onboarded, setOnboarded] = useState(true)
  const { settings } = useSettings()

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    setActiveTab(tab === 'settings' ? 'settings' : 'timer')
    setOnboarded(localStorage.getItem(ONBOARDED_KEY) === '1')
    setMounted(true)
  }, [])

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

  const finishOnboarding = () => {
    localStorage.setItem(ONBOARDED_KEY, '1')
    setOnboarded(true)
  }

  const focusTask = (payload: PendingFocus) => {
    setPendingFocus(payload)
    setImmersive(false)
    setActiveTab('timer')
  }

  const clearPendingFocus = () => setPendingFocus(null)

  const renderTab = (id: AppTab) => {
    if (id === 'timer') {
      return <Timer onImmersive={setImmersive} pendingFocus={pendingFocus} clearPendingFocus={clearPendingFocus} />
    }
    if (id === 'tasks') return <Tasks onFocusTask={focusTask} />
    if (id === 'calendar') return <Calendar />
    if (id === 'insights') return <Analytics />
    return <Settings />
  }

  return (
    <App theme="ios" dark={settings.darkMode} safeAreas>
      <div className="app-shell">
        {!mounted ? (
          <div className="app-content" />
        ) : !onboarded ? (
          <Onboarding onDone={finishOnboarding} />
        ) : (
          <>
            <div className="app-content">
              {(['timer', 'tasks', 'calendar', 'insights', 'settings'] as AppTab[]).map(id => (
                <section
                  key={id}
                  data-active={activeTab === id}
                  data-scroll={id !== 'timer'}
                  className="app-tabpanel"
                >
                  {renderTab(id)}
                </section>
              ))}
            </div>

            {!immersive && <TabBar activeTab={activeTab} onChange={setActiveTab} />}
          </>
        )}
      </div>
    </App>
  )
}
