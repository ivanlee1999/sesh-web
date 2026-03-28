'use client'
import React from 'react'
import { useSettings } from '@/context/SettingsContext'
import { useEffect, useState } from 'react'


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
      // Poll for completion
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-green-600">✓ Connected to Google Calendar</p>
        <a href="/api/auth/google/disconnect" className="text-xs text-red-500 hover:underline">Disconnect</a>
      </div>
    )
  }

  if (step === 'pending') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">Go to this URL and enter the code:</p>
        <a href={verifyUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-sm block">{verifyUrl}</a>
        <div className="bg-gray-100 dark:bg-gray-800 rounded-xl px-4 py-3 text-center">
          <span className="font-mono text-2xl font-bold tracking-widest">{userCode}</span>
        </div>
        <p className="text-xs text-gray-400 text-center">Waiting for authorization...</p>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-700 dark:text-gray-300">Sync sessions to calendar</p>
        <p className="text-xs text-gray-400 mt-0.5">Not connected</p>
      </div>
      <button onClick={startAuth} className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
        Connect
      </button>
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
      } catch {
        setPushEnabled(false)
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
        // Server rejected the subscription — unsubscribe the browser side so
        // the local-notification fallback in Timer keeps working.
        await sub.unsubscribe()
        throw new Error('Server failed to save push subscription')
      }

      // Persist confirmation so Timer.tsx can distinguish "server has our sub"
      // from "browser has a sub the server never stored".
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
    ? 'Permission denied in browser settings'
    : pushEnabled
    ? 'Enabled'
    : 'Disabled'

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-700 dark:text-gray-300">Session completion alerts</p>
        <p className="text-xs text-gray-400 mt-0.5">{statusText}</p>
      </div>
      <button
        disabled={!pushSupported || pushPermission === 'denied' || pushBusy}
        onClick={() => {
          if (pushEnabled) disablePush()
          else enablePush()
        }}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          pushEnabled ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-600'
        } ${(!pushSupported || pushPermission === 'denied' || pushBusy) ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            pushEnabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
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
    <div className="px-4 pt-16 md:pt-20 pb-4">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">Settings</h1>

      <div className="flex flex-col gap-4">
        {/* Timer durations */}
        <Section title="Timer Durations">
          <NumberField
            label="Focus"
            value={settings.focusDuration}
            min={1} max={120}
            onChange={v => updateSettings({ focusDuration: v })}
            unit="min"
          />
          <NumberField
            label="Short Break"
            value={settings.shortBreakDuration}
            min={1} max={60}
            onChange={v => updateSettings({ shortBreakDuration: v })}
            unit="min"
          />
          <NumberField
            label="Long Break"
            value={settings.longBreakDuration}
            min={1} max={120}
            onChange={v => updateSettings({ longBreakDuration: v })}
            unit="min"
          />
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <Toggle
            label="Sound on completion"
            checked={settings.soundEnabled}
            onChange={v => updateSettings({ soundEnabled: v })}
          />
        </Section>

        {/* Push Notifications */}
        <Section title="Push Notifications">
          <PushNotificationToggle />
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <Toggle
            label="Dark mode"
            checked={settings.darkMode}
            onChange={v => {
              updateSettings({ darkMode: v })
              document.documentElement.classList.toggle('dark', v)
            }}
          />
        </Section>

        {/* Google Calendar */}
        <Section title="Google Calendar">
          <DeviceFlowAuth connected={calConnected} onConnected={() => {
            setCalConnected(true)
            updateSettings({ calendarSync: true })
          }} />
          {calConnected && (
            <Toggle
              label="Auto-sync to Google Calendar"
              checked={settings.calendarSync}
              onChange={v => updateSettings({ calendarSync: v })}
            />
          )}
        </Section>

        {/* About */}
        <Section title="About">
          <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
            <p>sesh-web v0.1.0</p>
            <p>PWA Pomodoro timer</p>
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

function NumberField({
  label, value, min, max, onChange, unit,
}: {
  label: string; value: number; min: number; max: number
  onChange: (v: number) => void; unit: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          −
        </button>
        <span className="font-mono text-sm w-12 text-center text-gray-900 dark:text-gray-100">
          {value} {unit}
        </span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          +
        </button>
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}
