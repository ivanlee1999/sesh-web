'use client'
import React from 'react'
import { useSettings } from '@/context/SettingsContext'
import { useEffect, useState } from 'react'
import { List, ListItem, BlockTitle, Toggle, Button } from 'konsta/react'

function DeviceFlowAuth({ connected, onConnected }: { connected: boolean; onConnected: () => void }) {
  const [step, setStep] = React.useState<'idle' | 'pending' | 'done'>('idle')
  const [userCode, setUserCode] = React.useState('')
  const [verifyUrl, setVerifyUrl] = React.useState('')

  const startAuth = async () => {
    const res = await fetch('/api/auth/device', { method: 'POST' })
    const data = await res.json()
    if (data.user_code) {
      setUserCode(data.user_code)
      setVerifyUrl(data.verification_url)
      setStep('pending')
      const interval = setInterval(async () => {
        const pollRes = await fetch('/api/auth/device/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: data.device_code }),
        })
        const pollData = await pollRes.json()
        if (pollData.success) {
          clearInterval(interval)
          setStep('done')
          onConnected()
        }
      }, (data.interval || 5) * 1000)
    }
  }

  if (connected || step === 'done') {
    return (
      <ListItem
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            Connected
          </span>
        }
        after={
          <a
            href="/api/auth/google/disconnect"
            style={{ fontSize: 13, color: 'var(--danger)', textDecoration: 'none' }}
          >
            Disconnect
          </a>
        }
      />
    )
  }

  if (step === 'pending') {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Go to this URL and enter the code:</p>
        <a href={verifyUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: 'var(--accent)' }}>{verifyUrl}</a>
        <div style={{
          background: 'var(--bg-elevated)', borderRadius: 12, padding: '16px', textAlign: 'center',
        }}>
          <span className="font-mono" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--text-primary)' }}>
            {userCode}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>Waiting for authorization...</p>
      </div>
    )
  }

  return (
    <ListItem
      title="Google Calendar"
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
      title="Session alerts"
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
    <div style={{ padding: '24px 20px', paddingBottom: 96 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 28 }}>Settings</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Timer Durations */}
        <div>
          <BlockTitle>Timer Durations</BlockTitle>
          <List strong inset>
            <NumberRow
              label="Focus"
              value={settings.focusDuration}
              min={1} max={120}
              onChange={v => updateSettings({ focusDuration: v })}
            />
            <NumberRow
              label="Short Break"
              value={settings.shortBreakDuration}
              min={1} max={60}
              onChange={v => updateSettings({ shortBreakDuration: v })}
            />
            <NumberRow
              label="Long Break"
              value={settings.longBreakDuration}
              min={1} max={120}
              onChange={v => updateSettings({ longBreakDuration: v })}
            />
          </List>
        </div>

        {/* Notifications */}
        <div>
          <BlockTitle>Notifications</BlockTitle>
          <List strong inset>
            <ListItem
              title="Sound on completion"
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

        {/* Appearance section removed — dark mode deleted */}

        {/* Google Calendar */}
        <div>
          <BlockTitle>Google Calendar</BlockTitle>
          <List strong inset>
            <DeviceFlowAuth connected={calConnected} onConnected={() => {
              setCalConnected(true)
              updateSettings({ calendarSync: true })
            }} />
            {calConnected && (
              <ListItem
                title="Auto-sync sessions"
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

        {/* About */}
        <div>
          <BlockTitle>About</BlockTitle>
          <List strong inset>
            <ListItem
              title="sesh-web v0.1.0"
              subtitle="PWA Pomodoro timer"
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
      title={label}
      after={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button
            small
            outline
            rounded
            onClick={() => onChange(Math.max(min, value - 1))}
            className="!w-8 !h-8 !p-0"
          >
            −
          </Button>
          <span className="font-mono" style={{ fontSize: 15, color: 'var(--text-primary)', width: 48, textAlign: 'center' }}>
            {value}m
          </span>
          <Button
            small
            outline
            rounded
            onClick={() => onChange(Math.min(max, value + 1))}
            className="!w-8 !h-8 !p-0"
          >
            +
          </Button>
        </div>
      }
    />
  )
}
