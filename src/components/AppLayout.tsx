'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSettings } from '@/context/SettingsContext'
import { useNativeGestureLock } from '@/hooks/useNativeGestureLock'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { ensurePushSubscription } from '@/lib/push-client'
import { enabledProviders, loadProviderStatuses, type ProviderStatus } from '@/lib/task-sources'
import { accentPair, applyAccent, applyThemeColor, DEFAULT_ACCENT } from '@/lib/accent'
import { saveAccent } from '@/lib/local-store'
import Timer from './Timer'
import Tasks, { type PendingFocus } from './Tasks'
import Calendar from './Calendar'
import Analytics from './Analytics'
import Settings from './Settings'
import Onboarding from './Onboarding'
import TabBar, { APP_TABS, type AppTab } from './TabBar'
import NavRail from './md/NavRail'
import { ShellStatusContext } from './md/shell-status'

const ONBOARDED_KEY = 'sesh:onboarded'

const TAB_TITLE: Record<AppTab, string> = {
  timer: 'Focus',
  tasks: 'Tasks',
  calendar: 'Calendar',
  insights: 'Insights',
  settings: 'Settings',
}

const TAB_SUB: Record<AppTab, string> = {
  timer: 'Ready when you are',
  tasks: 'Todoist and Things, merged',
  calendar: 'Session log by day',
  insights: 'Last 7 days',
  settings: 'Device + account',
}

export default function AppLayout() {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTab>('timer')
  const [focusMode, setFocusMode] = useState(false)
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null)
  const [onboarded, setOnboarded] = useState(true)
  const [subs, setSubs] = useState<Partial<Record<AppTab, string>>>({})
  const [openTasks, setOpenTasks] = useState<number | null>(null)
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [accent, setAccent] = useState<string | null>(null)
  const { settings } = useSettings()
  const isDesktop = useIsDesktop()

  useNativeGestureLock()

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

  // Only the rail footer needs these, so they are fetched once here rather
  // than by every screen that happens to mention a provider.
  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    loadProviderStatuses(enabledProviders(settings))
      .then(next => { if (!cancelled) setStatuses(next) })
      .catch(() => { if (!cancelled) setStatuses([]) })
    return () => { cancelled = true }
  }, [isDesktop, settings.todoistEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A running session inverts the whole shell, so the document has to invert
   * with it — not just the app element.
   *
   * `body` paints the area the app element does not cover, which on iOS with
   * `viewport-fit=cover` includes the strip behind the status bar. With the
   * flag only on the app div, `body { background: var(--bg) }` still resolved
   * light from `:root`, so entering focus mode left a light bar above a dark
   * screen. Setting it on the root element means one palette owns the whole
   * document.
   *
   * The browser and PWA chrome follows the same rule.
   */
  useEffect(() => {
    const dark = focusMode || settings.darkMode
    const root = document.documentElement
    root.dataset.focusmode = focusMode ? 'true' : 'false'
    root.style.colorScheme = dark ? 'dark' : 'light'
    applyThemeColor(root, dark)
  }, [focusMode, settings.darkMode])

  /**
   * The interface takes its colour from the category in play.
   *
   * Both grounds are worked out together and stored, so the next boot can
   * paint the accent before React has run — and so the switch into a running
   * session, which turns the ground dark whatever the preference is, is a
   * variable swap rather than a recalculation.
   */
  useEffect(() => {
    if (accent === null) return
    const pair = accentPair(accent)
    applyAccent(document.documentElement, focusMode || settings.darkMode ? pair.dark : pair.light)
    // The ground moved with the accent, so the chrome behind the status bar
    // has to move with it too.
    applyThemeColor(document.documentElement, focusMode || settings.darkMode)
    saveAccent(pair)
  }, [accent, focusMode, settings.darkMode])

  const reportSub = useCallback((tab: AppTab, sub: string | null) => {
    setSubs(prev => (prev[tab] === (sub ?? undefined) ? prev : { ...prev, [tab]: sub ?? undefined }))
  }, [])

  const reportOpenTasks = useCallback((count: number | null) => {
    setOpenTasks(prev => (prev === count ? prev : count))
  }, [])

  const reportAccent = useCallback((color: string | null) => {
    setAccent(prev => (prev === (color ?? DEFAULT_ACCENT) ? prev : color ?? DEFAULT_ACCENT))
  }, [])

  const shellStatus = useMemo(
    () => ({ reportSub, reportOpenTasks, reportAccent }),
    [reportAccent, reportOpenTasks, reportSub],
  )

  const finishOnboarding = () => {
    localStorage.setItem(ONBOARDED_KEY, '1')
    setOnboarded(true)
  }

  const focusTask = (payload: PendingFocus) => {
    setPendingFocus(payload)
    setFocusMode(false)
    setActiveTab('timer')
  }

  const clearPendingFocus = () => setPendingFocus(null)

  const renderTab = (id: AppTab) => {
    if (id === 'timer') {
      return (
        <Timer
          onImmersive={setFocusMode}
          pendingFocus={pendingFocus}
          clearPendingFocus={clearPendingFocus}
        />
      )
    }
    if (id === 'tasks') return <Tasks onFocusTask={focusTask} />
    if (id === 'calendar') return <Calendar />
    if (id === 'insights') return <Analytics />
    return <Settings onReplayIntro={() => setOnboarded(false)} />
  }

  const showRail = isDesktop && !focusMode
  const showTabBar = !isDesktop && !focusMode
  const headStatus = focusMode ? 'Running' : 'Synced'

  const shell = (
    <div
      className="md-app"
      data-mode={isDesktop ? 'desktop' : 'phone'}
      data-dark={settings.darkMode ? 'true' : 'false'}
      data-focusmode={focusMode ? 'true' : 'false'}
    >
      {showRail && (
        <NavRail
          activeTab={activeTab}
          onChange={setActiveTab}
          openTasks={openTasks}
          sources={statuses.map(s => ({
            provider: s.provider,
            state: s.state === 'connected' ? 'synced' : s.state === 'checking' ? '…' : 'off',
          }))}
        />
      )}

      <div className="md-main" id="sesh-main">
        {!focusMode && !isDesktop && (
          <header
            style={{
              flex: 'none',
              padding: 'calc(var(--safe-t) + 10px) 18px 9px',
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              borderBottom: '1px solid var(--line)',
            }}
          >
            <strong style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 17, letterSpacing: '-.02em' }}>
              sesh
            </strong>
            <span className="md-meta" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--good)' }} />
              {headStatus}
            </span>
          </header>
        )}

        {!focusMode && isDesktop && (
          <header
            style={{
              flex: 'none',
              padding: '18px 32px 14px',
              display: 'flex',
              alignItems: 'baseline',
              gap: 14,
              borderBottom: '1px solid var(--line)',
            }}
          >
            <h1 className="md-title" style={{ fontSize: 24 }}>{TAB_TITLE[activeTab]}</h1>
            <span className="md-meta" style={{ fontSize: 13 }}>
              {subs[activeTab] ?? TAB_SUB[activeTab]}
            </span>
            <span className="md-meta" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--good)' }} />
              {headStatus}
            </span>
          </header>
        )}

        <div className="md-pane">
          {APP_TABS.map(({ id }) => (
            <div
              key={id}
              role="tabpanel"
              hidden={activeTab !== id}
              style={activeTab === id
                ? { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }
                : undefined}
            >
              {renderTab(id)}
            </div>
          ))}
        </div>

        {showTabBar && <TabBar activeTab={activeTab} onChange={setActiveTab} />}
      </div>
    </div>
  )

  if (!mounted) return <div className="md-app" />

  if (!onboarded) {
    return (
      <div className="md-app" data-mode={isDesktop ? 'desktop' : 'phone'} data-dark={settings.darkMode ? 'true' : 'false'}>
        <div className="md-main">
          <Onboarding onDone={finishOnboarding} phone={!isDesktop} />
        </div>
      </div>
    )
  }

  return <ShellStatusContext.Provider value={shellStatus}>{shell}</ShellStatusContext.Provider>
}
