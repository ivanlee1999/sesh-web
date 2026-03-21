'use client'
import { useSettings } from '@/context/SettingsContext'
import { useEffect, useState } from 'react'

export default function Settings() {
  const { settings, updateSettings } = useSettings()
  const [calConnected, setCalConnected] = useState(false)

  useEffect(() => {
    setCalConnected(!!document.cookie.includes('gcal_token'))
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
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Sync sessions to calendar</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {calConnected ? 'Connected' : 'Not connected'}
              </p>
            </div>
            {calConnected ? (
              <a
                href="/api/auth/google/disconnect"
                className="text-xs text-red-500 hover:underline"
              >
                Disconnect
              </a>
            ) : (
              <a
                href="/api/auth/google"
                className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
              >
                Connect
              </a>
            )}
          </div>
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
