'use client'
import React from 'react'
import { useSettings } from '@/context/SettingsContext'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

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
      <div className="settings-row">
        <div>
          <p className="settings-row__label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            Connected
          </p>
        </div>
        <a
          href="/api/auth/google/disconnect"
          style={{ fontSize: 13, color: 'var(--danger)', textDecoration: 'none' }}
        >
          Disconnect
        </a>
      </div>
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
    <div className="settings-row">
      <div>
        <p className="settings-row__label">Google Calendar</p>
        <p className="settings-row__detail">Not connected</p>
      </div>
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={startAuth}
        style={{
          padding: '6px 14px', borderRadius: 8, border: 'none',
          background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer',
        }}
      >
        Connect
      </motion.button>
    </div>
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
    <div className="settings-row">
      <div>
        <p className="settings-row__label">Session alerts</p>
        <p className="settings-row__detail">{statusText}</p>
      </div>
      <IOSSwitch
        checked={pushEnabled}
        disabled={!pushSupported || pushPermission === 'denied' || pushBusy}
        onChange={() => { if (pushEnabled) disablePush(); else enablePush() }}
      />
    </div>
  )
}

function IOSSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`ios-switch ${checked ? 'ios-switch--on' : ''}`}
      style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <span className="ios-switch__thumb" />
    </button>
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
    <div style={{ padding: '24px 20px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 28 }}>Settings</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Timer Durations */}
        <SettingsGroup title="Timer Durations">
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
        </SettingsGroup>

        {/* Notifications */}
        <SettingsGroup title="Notifications">
          <div className="settings-row">
            <p className="settings-row__label">Sound on completion</p>
            <IOSSwitch
              checked={settings.soundEnabled}
              onChange={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
            />
          </div>
          <PushNotificationToggle />
        </SettingsGroup>

        {/* Appearance */}
        <SettingsGroup title="Appearance">
          <div className="settings-row">
            <p className="settings-row__label">Dark mode</p>
            <IOSSwitch
              checked={settings.darkMode}
              onChange={() => updateSettings({ darkMode: !settings.darkMode })}
            />
          </div>
        </SettingsGroup>

        {/* Google Calendar */}
        <SettingsGroup title="Google Calendar">
          <DeviceFlowAuth connected={calConnected} onConnected={() => {
            setCalConnected(true)
            updateSettings({ calendarSync: true })
          }} />
          {calConnected && (
            <div className="settings-row">
              <p className="settings-row__label">Auto-sync sessions</p>
              <IOSSwitch
                checked={settings.calendarSync}
                onChange={() => updateSettings({ calendarSync: !settings.calendarSync })}
              />
            </div>
          )}
        </SettingsGroup>

        {/* About */}
        <SettingsGroup title="About">
          <div style={{ padding: '12px 16px' }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>sesh-web v0.1.0</p>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>PWA Pomodoro timer</p>
          </div>
        </SettingsGroup>
      </div>
    </div>
  )
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="section-label">{title}</p>
      <div className="group-card">
        {children}
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
    <div className="settings-row">
      <p className="settings-row__label">{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => onChange(Math.max(min, value - 1))}
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'var(--bg-elevated)', border: 'none',
            color: 'var(--text-primary)', fontSize: 16, fontWeight: 500,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          −
        </motion.button>
        <span className="font-mono" style={{ fontSize: 15, color: 'var(--text-primary)', width: 48, textAlign: 'center' }}>
          {value}m
        </span>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => onChange(Math.min(max, value + 1))}
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'var(--bg-elevated)', border: 'none',
            color: 'var(--text-primary)', fontSize: 16, fontWeight: 500,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          +
        </motion.button>
      </div>
    </div>
  )
}
