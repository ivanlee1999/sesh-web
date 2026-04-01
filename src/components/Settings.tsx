'use client'
import React from 'react'
import { useSettings } from '@/context/SettingsContext'
import { useEffect, useState, useRef } from 'react'
import { List, ListItem, BlockTitle, Toggle, Button } from 'konsta/react'

function DeviceFlowAuth({ connected, onConnected }: { connected: boolean; onConnected: () => void }) {
  const [step, setStep] = React.useState<'idle' | 'pending' | 'done'>('idle')
  const [userCode, setUserCode] = React.useState('')
  const [verifyUrl, setVerifyUrl] = React.useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const startAuth = async () => {
    const res = await fetch('/api/auth/device', { method: 'POST' })
    const data = await res.json()
    if (data.user_code) {
      setUserCode(data.user_code)
      setVerifyUrl(data.verification_url)
      setStep('pending')
      intervalRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch('/api/auth/device/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: data.device_code }),
          })
          const pollData = await pollRes.json()
          if (pollData.success) {
            if (intervalRef.current) clearInterval(intervalRef.current)
            intervalRef.current = null
            setStep('done')
            onConnected()
          }
        } catch {
          // Continue polling
        }
      }, (data.interval || 5) * 1000)
    }
  }

  const handleDisconnect = async () => {
    try {
      await fetch('/api/auth/google/disconnect', { method: 'POST' })
      setStep('idle')
      // Force page reload to reset state
      window.location.reload()
    } catch {
      // Fallback to GET for backwards compatibility
      window.location.href = '/api/auth/google/disconnect'
    }
  }

  if (connected || step === 'done') {
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

  if (step === 'pending') {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">Go to this URL and enter the code:</p>
        <a
          href={verifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 underline dark:text-blue-400"
        >
          {verifyUrl}
        </a>
        <div className="rounded-xl bg-gray-50 p-4 text-center dark:bg-gray-900">
          <span className="font-mono text-2xl font-bold tracking-[0.2em] text-black dark:text-white">
            {userCode}
          </span>
        </div>
        <p className="text-center text-xs text-gray-400">Waiting for authorization...</p>
      </div>
    )
  }

  return (
    <ListItem
      title={<span className="text-black dark:text-white">Google Calendar</span>}
      subtitle="Not connected"
      after={
        <Button small rounded onClick={startAuth}>
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

  useEffect(() => {
    fetch('/api/auth/google/status')
      .then(res => res.json())
      .then(data => setCalConnected(data.connected))
      .catch(() => setCalConnected(false))
  }, [])

  return (
    <div className="px-5 pb-24 pt-6">
      <h1 className="mb-7 text-3xl font-bold text-black dark:text-white">Settings</h1>

      <div className="flex flex-col gap-6">
        {/* Timer Durations */}
        <div>
          <BlockTitle className="!text-black dark:!text-white">Timer</BlockTitle>
          <List strong inset>
            <NumberRow
              label="Focus duration"
              value={settings.focusDuration}
              min={1} max={120}
              onChange={v => updateSettings({ focusDuration: v })}
            />
            <NumberRow
              label="Short break"
              value={settings.shortBreakDuration}
              min={1} max={60}
              onChange={v => updateSettings({ shortBreakDuration: v })}
            />
            <NumberRow
              label="Long break"
              value={settings.longBreakDuration}
              min={1} max={120}
              onChange={v => updateSettings({ longBreakDuration: v })}
            />
          </List>
        </div>

        {/* Notifications */}
        <div>
          <BlockTitle className="!text-black dark:!text-white">Notifications</BlockTitle>
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
          <BlockTitle className="!text-black dark:!text-white">Integrations</BlockTitle>
          <List strong inset>
            <DeviceFlowAuth connected={calConnected} onConnected={() => {
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
          </List>
        </div>

        {/* Appearance */}
        <div>
          <BlockTitle className="!text-black dark:!text-white">Appearance</BlockTitle>
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
