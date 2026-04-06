'use client'
import React from 'react'
import { useSettings } from '@/context/SettingsContext'
import { useEffect, useState } from 'react'
import { List, ListItem, BlockTitle, Toggle, Button } from 'konsta/react'

function GoogleCalendarAuth({ connected, onConnected }: { connected: boolean; onConnected: () => void }) {
  const handleDisconnect = async () => {
    try {
      await fetch('/api/auth/google/disconnect', { method: 'POST' })
      // Force page reload to reset state
      window.location.reload()
    } catch {
      // Fallback to GET for backwards compatibility
      window.location.href = '/api/auth/google/disconnect'
    }
  }

  // Re-check connection status when the page gains focus (user returns from OAuth redirect)
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/auth/google/status')
        const data = await res.json()
        if (data.connected && !connected) onConnected()
      } catch { /* ignore */ }
    }
    window.addEventListener('focus', checkStatus)
    return () => window.removeEventListener('focus', checkStatus)
  }, [connected, onConnected])

  if (connected) {
    return (
      <ListItem
        title={
          <span className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-black dark:text-white">Connected</span>
          </span>
        }
        after={
          <button
            onClick={handleDisconnect}
            className="border-none bg-transparent text-sm text-red-500 dark:text-red-400"
          >
            Disconnect
          </button>
        }
      />
    )
  }

  return (
    <ListItem
      title={<span className="text-black dark:text-white">Google Calendar</span>}
      subtitle="Not connected"
      after={
        <Button small rounded onClick={() => { window.location.href = '/api/auth/google' }}>
          Connect
        </Button>
      }
    />
  )
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}

function PushNotificationToggle() {
  const [pushSupported, setPushSupported] = useState<boolean | null>(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')
  const [pushBusy, setPushBusy] = useState(false)

  useEffect(() => {
    const initPush = async () => {
      const supported =
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window

      setPushSupported(supported)
      if (!supported) return

      setPushPermission(Notification.permission)

      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setPushEnabled(!!sub)
        if (!sub) {
          try { localStorage.removeItem('pushSubscriptionConfirmed') } catch {}
        }
      } catch {
        setPushEnabled(false)
        try { localStorage.removeItem('pushSubscriptionConfirmed') } catch {}
      }
    }

    initPush()
  }, [])

  const enablePush = async () => {
    setPushBusy(true)
    try {
      const vapidRes = await fetch('/api/push/vapid', { cache: 'no-store' })
      const { publicKey } = await vapidRes.json()
      if (!publicKey) throw new Error('Missing public key')

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()

      setPushPermission(permission)
      if (permission !== 'granted') return

      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      })

      if (!res.ok) {
        await sub.unsubscribe()
        throw new Error('Server failed to save push subscription')
      }

      try { localStorage.setItem('pushSubscriptionConfirmed', '1') } catch {}
      setPushEnabled(true)
    } finally {
      setPushBusy(false)
    }
  }

  const disablePush = async () => {
    setPushBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      try { localStorage.removeItem('pushSubscriptionConfirmed') } catch {}
      setPushEnabled(false)
    } finally {
      setPushBusy(false)
    }
  }

  const statusText = !pushSupported
    ? 'Not supported in this browser'
    : pushPermission === 'denied'
    ? 'Permission denied'
    : pushEnabled
    ? 'Enabled'
    : 'Disabled'

  return (
    <ListItem
      title={<span className="text-black dark:text-white">Session alerts</span>}
      subtitle={statusText}
      after={
        <Toggle
          checked={pushEnabled}
          disabled={!pushSupported || pushPermission === 'denied' || pushBusy}
          onChange={() => { if (pushEnabled) disablePush(); else enablePush() }}
        />
      }
    />
  )
}

export default function Settings() {
  const { settings, updateSettings } = useSettings()
  const [calConnected, setCalConnected] = useState(false)
  const [manualSyncBusy, setManualSyncBusy] = useState(false)
  const [syncNotice, setSyncNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    fetch('/api/auth/google/status')
      .then(res => res.json())
      .then(data => setCalConnected(data.connected))
      .catch(() => setCalConnected(false))
  }, [])

  const handleManualSync = async () => {
    setManualSyncBusy(true)
    setSyncNotice(null)
    try {
      const res = await fetch('/api/calendar/sync-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? 'Sync failed')
      }
      if (data.failedCount > 0 && data.syncedCount === 0) {
        throw new Error('All sessions failed to sync')
      }
      if (data.syncedCount === 0 && data.results?.length === 0) {
        setSyncNotice({ type: 'success', message: 'All sessions already synced' })
      } else {
        setSyncNotice({ type: 'success', message: `Synced ${data.syncedCount} session(s)` })
      }
    } catch (err) {
      setSyncNotice({ type: 'error', message: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      setManualSyncBusy(false)
    }
  }

  return (
    <div className="px-5 pb-24 pt-6">
      <h1 className="mb-7 text-3xl font-bold text-black dark:text-white">Settings</h1>

      <div className="flex flex-col gap-6">
        {/* Timer Durations */}
        <div>
          <BlockTitle className="!text-xs !font-semibold !uppercase !tracking-[0.06em] !text-gray-500 dark:!text-gray-400">Timer</BlockTitle>
          <List strong inset>
            <NumberRow
              label="Focus duration"
              value={settings.focusDuration}
              min={1} max={120}
              onChange={v => updateSettings({ focusDuration: v })}
            />
            <NumberRow
              label="Rest duration"
              value={settings.breakDuration}
              min={1} max={60}
              onChange={v => updateSettings({ breakDuration: v })}
            />
          </List>
        </div>

        {/* Notifications */}
        <div>
          <BlockTitle className="!text-xs !font-semibold !uppercase !tracking-[0.06em] !text-gray-500 dark:!text-gray-400">Notifications</BlockTitle>
          <List strong inset>
            <ListItem
              title={<span className="text-black dark:text-white">Sound</span>}
              after={
                <Toggle
                  checked={settings.soundEnabled}
                  onChange={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
                />
              }
            />
            <PushNotificationToggle />
          </List>
        </div>

        {/* Integrations */}
        <div>
          <BlockTitle className="!text-xs !font-semibold !uppercase !tracking-[0.06em] !text-gray-500 dark:!text-gray-400">Integrations</BlockTitle>
          <List strong inset>
            <GoogleCalendarAuth connected={calConnected} onConnected={() => {
              setCalConnected(true)
              updateSettings({ calendarSync: true })
            }} />
            {calConnected && (
              <ListItem
                title={<span className="text-black dark:text-white">Auto-sync sessions</span>}
                after={
                  <Toggle
                    checked={settings.calendarSync}
                    onChange={() => updateSettings({ calendarSync: !settings.calendarSync })}
                  />
                }
              />
            )}
            {calConnected && (
              <ListItem
                title={<span className="text-black dark:text-white">Manual sync</span>}
                subtitle="Sync recent unsynced sessions"
                after={
                  <Button
                    small
                    rounded
                    disabled={manualSyncBusy}
                    onClick={handleManualSync}
                  >
                    {manualSyncBusy ? 'Syncing...' : 'Sync Now'}
                  </Button>
                }
              />
            )}
          </List>
          {syncNotice && (
            <p className={`mt-2 px-4 text-sm ${syncNotice.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {syncNotice.message}
            </p>
          )}
        </div>

        {/* Appearance */}
        <div>
          <BlockTitle className="!text-xs !font-semibold !uppercase !tracking-[0.06em] !text-gray-500 dark:!text-gray-400">Appearance</BlockTitle>
          <List strong inset>
            <ListItem
              title={<span className="text-black dark:text-white">Dark mode</span>}
              after={
                <Toggle
                  checked={settings.darkMode}
                  onChange={() => updateSettings({ darkMode: !settings.darkMode })}
                />
              }
            />
          </List>
        </div>
      </div>
    </div>
  )
}

function NumberRow({
  label, value, min, max, onChange,
}: {
  label: string; value: number; min: number; max: number
  onChange: (v: number) => void
}) {
  return (
    <ListItem
      title={<span className="text-black dark:text-white">{label}</span>}
      after={
        <div className="flex items-center gap-3">
          <Button
            small
            outline
            rounded
            onClick={() => onChange(Math.max(min, value - 1))}
            className="!h-8 !w-8 !p-0"
          >
            −
          </Button>
          <span className="w-12 text-center font-mono text-sm text-black dark:text-white">
            {value}m
          </span>
          <Button
            small
            outline
            rounded
            onClick={() => onChange(Math.min(max, value + 1))}
            className="!h-8 !w-8 !p-0"
          >
            +
          </Button>
        </div>
      }
    />
  )
}
