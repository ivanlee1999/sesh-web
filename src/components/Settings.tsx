'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@/types'
import { useSettings } from '@/context/SettingsContext'
import { useCategories } from '@/context/CategoriesContext'
import { CATEGORY_PALETTE } from '@/lib/categories'
import { isAuthResponse, readApiError, redirectToLogin } from '@/lib/api-client'
import { clearPushSubscriptionConfirmed, ensurePushSubscription, isPushSupported } from '@/lib/push-client'
import { ACCENT_OPTIONS, Btn, Group, Icon, Row, ScreenHead, Sheet, Stepper, Toggle, Wordmark, fmtHM } from './sesh-ui'

type TodoistConnection =
  | { kind: 'checking'; message: string }
  | { kind: 'connected'; message: string }
  | { kind: 'not_configured'; message: string }
  | { kind: 'auth_required'; message: string }
  | { kind: 'error'; message: string }

type ManualSyncResult = {
  synced?: boolean
  skipped?: string
  error?: string
}

function calendarSkipMessage(reason: string) {
  if (reason === 'disabled') return 'Calendar sync is off. Enable Auto-sync sessions, then sync again.'
  if (reason === 'not_connected') return 'Google Calendar is not connected. Reconnect Calendar, then sync again.'
  if (reason === 'token_error') return 'Google token refresh failed. Reconnect Google Calendar.'
  if (reason === 'rest_session') return 'Only break sessions were skipped.'
  return `Skipped: ${reason}`
}

function PushNotificationToggle() {
  const [pushSupported, setPushSupported] = useState<boolean | null>(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const init = async () => {
      const supported = isPushSupported()
      setPushSupported(supported)
      if (!supported) return
      setPushPermission(Notification.permission)
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setPushEnabled(!!sub)
        if (!sub) clearPushSubscriptionConfirmed()
      } catch {
        setPushEnabled(false)
        clearPushSubscriptionConfirmed()
      }
    }
    init()
  }, [])

  const enable = async () => {
    setBusy(true)
    try {
      const enabled = await ensurePushSubscription({ requestPermission: true })
      setPushPermission(Notification.permission)
      setPushEnabled(enabled)
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
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
      clearPushSubscriptionConfirmed()
      setPushEnabled(false)
    } finally {
      setBusy(false)
    }
  }

  const status = !pushSupported
    ? 'Not supported in this browser'
    : pushPermission === 'denied'
      ? 'Permission denied'
      : pushEnabled ? 'Enabled' : 'Disabled'

  return (
    <Row
      icon="bell"
      title="Session alerts"
      sub={status}
      right={<Toggle on={pushEnabled} disabled={!pushSupported || pushPermission === 'denied' || busy} onChange={() => { if (pushEnabled) disable(); else enable() }} />}
    />
  )
}

function CategorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { categories, createCategory, updateCategory, deleteCategory } = useCategories()
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [color, setColor] = useState(CATEGORY_PALETTE[0])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!label.trim()) return
    setBusy(true)
    setError(null)
    const result = await createCategory({ label: label.trim(), color })
    if (!result.ok) setError(result.error ?? 'Failed to add category')
    else {
      setLabel('')
      setColor(CATEGORY_PALETTE[categories.length % CATEGORY_PALETTE.length])
      setAdding(false)
    }
    setBusy(false)
  }

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    const result = await deleteCategory(id)
    if (!result.ok) {
      setError(result.sessionCount ? `Cannot delete: ${result.sessionCount} sessions use this category` : result.error ?? 'Failed to delete category')
    }
    setBusy(false)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Categories">
      <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
        {categories.map(category => (
          <div key={category.id} className="flex items-center gap-3 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-3 py-[10px]">
            <ColorDots value={category.color} onChange={(next) => updateCategory(category.id, { color: next })} compact />
            <input
              value={category.label}
              onChange={event => updateCategory(category.id, { label: event.target.value })}
              className="min-w-0 flex-1 border-0 bg-transparent text-[15px] font-semibold text-[var(--ink)] outline-none"
            />
            {categories.length > 1 && (
              <button type="button" onClick={() => remove(category.id)} disabled={busy} className="border-0 bg-transparent p-1 text-[var(--ink-3)]">
                <Icon name="trash" size={17} />
              </button>
            )}
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-[14px] rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-[14px] py-3">
          <input
            autoFocus
            value={label}
            onChange={event => setLabel(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') add() }}
            placeholder="Category name"
            className="mb-3 w-full border-0 border-b border-[var(--line)] bg-transparent px-0 py-2 text-[15px] font-semibold text-[var(--ink)] outline-none"
          />
          <ColorDots value={color} onChange={setColor} />
          <div className="mt-[14px] flex gap-2">
            <Btn full variant="soft" size="sm" onClick={() => setAdding(false)}>Cancel</Btn>
            <Btn full size="sm" onClick={add} disabled={busy}>Add</Btn>
          </div>
        </div>
      ) : (
        <div className="mt-[14px]">
          <Btn full variant="outline" icon="plus" onClick={() => setAdding(true)}>New category</Btn>
        </div>
      )}
      {error && <div className="mt-3 text-[13px] text-[#C2615A]">{error}</div>}
      <div className="mt-[14px]"><Btn full size="lg" onClick={onClose}>Done</Btn></div>
    </Sheet>
  )
}

function ColorDots({ value, onChange, compact }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const colors = compact ? [value] : CATEGORY_PALETTE
  return (
    <div className="flex flex-wrap gap-[7px]">
      {colors.map(col => (
        <button
          key={col}
          type="button"
          onClick={() => onChange(col)}
          className="rounded-full p-0"
          style={{
            width: compact ? 22 : 30,
            height: compact ? 22 : 30,
            background: col,
            border: value === col ? '2.5px solid var(--ink)' : '2.5px solid transparent',
          }}
        />
      ))}
    </div>
  )
}

function ProfileScreen({ onBack }: { onBack: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [stats, setStats] = useState<{ streak: number; todayMs: number } | null>(null)

  useEffect(() => {
    fetch('/api/sessions').then(res => res.ok ? res.json() : []).then(setSessions).catch(() => setSessions([]))
    fetch('/api/analytics').then(res => res.ok ? res.json() : null).then(setStats).catch(() => setStats(null))
  }, [])

  const totalMin = Math.round(sessions.filter(s => s.type === 'focus').reduce((sum, s) => sum + s.actualMs, 0) / 60000)

  return (
    <div className="h-full w-full min-w-0 overflow-y-auto pb-[var(--screen-bottom-space)]">
      <div className="px-[22px] pt-[calc(58px+var(--safe-t))]">
        <button type="button" onClick={onBack} className="grid h-10 w-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]">
          <Icon name="back" size={20} />
        </button>
      </div>

      <div className="flex flex-col items-center px-[22px] pb-[26px] pt-[22px] text-center">
        <div className="grid h-[86px] w-[86px] place-items-center rounded-full bg-[var(--accent)] text-[36px] font-bold text-white">I</div>
        <h1 className="mb-[3px] mt-4 font-[var(--font-display)] text-[25px] font-bold tracking-[-0.03em]">Ivan</h1>
        <div className="text-[14.5px] text-[var(--ink-3)]">Private sesh workspace</div>
      </div>

      <div className="px-[22px]">
        <div className="mb-[22px] flex gap-3">
          <MiniStat value={stats?.streak ?? 0} label="day streak" icon="flame" />
          <MiniStat value={sessions.length} label="sessions" icon="check" />
          <MiniStat value={fmtHM(totalMin)} label="focused" icon="timer" />
        </div>
        <Group label="Connected">
          <Row icon="bell" title="Slack" sub="Auto-update status while focusing" right={<Toggle on onChange={() => {}} />} />
          <Row icon="apple" title="Apple Health" sub="Mindful minutes" last right={<Toggle on={false} onChange={() => {}} />} />
        </Group>
        <div className="text-center text-[13px] text-[var(--ink-3)]">Member since 2024</div>
      </div>
    </div>
  )
}

function MiniStat({ value, label, icon }: { value: string | number; label: string; icon: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <div className="flex-1 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-3 py-4">
      <Icon name={icon} size={18} color="var(--accent)" />
      <div className="mt-2 text-[20px] font-bold tracking-[-0.03em]">{value}</div>
      <div className="mt-1 text-[11.5px] text-[var(--ink-3)]">{label}</div>
    </div>
  )
}

export default function Settings() {
  const { settings, updateSettings } = useSettings()
  const { categories } = useCategories()
  const [profile, setProfile] = useState(false)
  const [catSheet, setCatSheet] = useState(false)
  const [calConnected, setCalConnected] = useState(false)
  const [todoist, setTodoist] = useState<TodoistConnection>({ kind: 'checking', message: 'Checking Todoist...' })
  const [manualSyncBusy, setManualSyncBusy] = useState(false)
  const [syncNotice, setSyncNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    fetch('/api/auth/google/status')
      .then(async res => {
        if (isAuthResponse(res)) redirectToLogin()
        if (!res.ok) throw new Error(await readApiError(res, 'Google Calendar status check failed'))
        return res.json()
      })
      .then(data => setCalConnected(!!data.connected))
      .catch(() => setCalConnected(false))
  }, [])

  const checkTodoist = useCallback(async () => {
    setTodoist({ kind: 'checking', message: 'Checking Todoist...' })
    try {
      const res = await fetch('/api/todoist/status')
      if (isAuthResponse(res)) {
        setTodoist({ kind: 'auth_required', message: 'Auth required. Sign in again to use Todoist.' })
        return
      }
      if (!res.ok) {
        setTodoist({ kind: 'error', message: await readApiError(res, 'Todoist status check failed') })
        return
      }
      const data = await res.json()
      if (data.configured) {
        setTodoist({ kind: 'connected', message: 'Connected' })
      } else {
        setTodoist({ kind: 'not_configured', message: 'Set TODOIST_API_TOKEN on the server to enable task sync.' })
      }
    } catch (err) {
      setTodoist({ kind: 'error', message: err instanceof Error ? err.message : 'Todoist status check failed' })
    }
  }, [])

  useEffect(() => { void checkTodoist() }, [checkTodoist])

  const manualSync = async () => {
    setManualSyncBusy(true)
    setSyncNotice(null)
    try {
      const res = await fetch('/api/calendar/sync-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? await readApiError(res, 'Calendar sync failed'))

      const results = (data.results ?? []) as ManualSyncResult[]
      const failed = results.find(result => !result.synced && !result.skipped)
      if (failed) {
        throw new Error(failed.error ?? 'Calendar sync failed')
      }

      const skipped = results.find(result => !result.synced && result.skipped)
      if (data.syncedCount > 0) {
        const skippedNote = skipped?.skipped ? `; ${calendarSkipMessage(skipped.skipped)}` : ''
        setSyncNotice({ type: 'success', message: `Synced ${data.syncedCount} session(s)${skippedNote}` })
      } else if (skipped?.skipped) {
        setSyncNotice({ type: 'error', message: calendarSkipMessage(skipped.skipped) })
      } else {
        setSyncNotice({ type: 'success', message: 'All sessions already synced' })
      }
    } catch (err) {
      setSyncNotice({ type: 'error', message: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      setManualSyncBusy(false)
    }
  }

  if (profile) return <ProfileScreen onBack={() => setProfile(false)} />

  const todoistBusy = todoist.kind === 'checking'
  const todoistConnected = todoist.kind === 'connected'

  return (
    <div className="h-full w-full min-w-0 overflow-y-auto pb-[var(--screen-bottom-space)]">
      <ScreenHead title="Settings" />
      <div className="px-[22px] py-4">
        <button type="button" onClick={() => setProfile(true)} className="mb-[22px] flex w-full items-center gap-[15px] rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-[18px] py-4 text-left">
          <div className="grid h-[52px] w-[52px] flex-shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[21px] font-bold text-white">I</div>
          <div className="flex-1">
            <div className="text-[17px] font-bold tracking-[-0.02em]">Ivan</div>
            <div className="text-[13.5px] text-[var(--ink-3)]">Private sesh workspace</div>
          </div>
          <Icon name="chevron" size={18} color="var(--ink-3)" />
        </button>

        <Group label="Timer">
          <Row icon="timer" title="Focus length" right={<Stepper value={settings.focusDuration} min={5} max={90} step={5} onChange={focusDuration => updateSettings({ focusDuration })} />} />
          <Row icon="leaf" title="Break length" right={<Stepper value={settings.breakDuration} min={1} max={30} onChange={breakDuration => updateSettings({ breakDuration })} />} />
          <Row icon="bell" title="Auto-start breaks" sub="Begin a break when focus ends" last right={<Toggle on={settings.autoStartBreak} onChange={autoStartBreak => updateSettings({ autoStartBreak })} />} />
        </Group>

        <Group label="Categories">
          {categories.map((category, i) => (
            <Row
              key={category.id}
              title={category.label}
              onClick={() => setCatSheet(true)}
              last={i === categories.length - 1}
              right={<span className="h-[18px] w-[18px] rounded-full" style={{ background: category.color }} />}
            />
          ))}
        </Group>
        <div className="-mt-[10px] mb-[22px]">
          <Btn full variant="soft" icon="plus" size="sm" onClick={() => setCatSheet(true)}>Manage categories</Btn>
        </div>

        <Group label="Integrations">
          <Row
            icon="list"
            title="Todoist"
            sub={todoist.message}
            right={
              <Btn
                size="sm"
                variant={todoistConnected ? 'soft' : 'outline'}
                disabled={todoistBusy}
                onClick={todoist.kind === 'auth_required' ? () => redirectToLogin() : checkTodoist}
              >
                {todoistBusy ? 'Checking...' : todoist.kind === 'auth_required' ? 'Sign in' : 'Check'}
              </Btn>
            }
          />
          <Row
            icon="check"
            title="Complete task on finish"
            sub={todoistConnected ? 'Tick off the task when a focus ends' : 'Available after Todoist connects'}
            right={<Toggle on={todoistConnected && settings.todoistAutoComplete} disabled={!todoistConnected} onChange={todoistAutoComplete => updateSettings({ todoistAutoComplete })} />}
          />
          <Row
            icon="calendar"
            title="Google Calendar"
            sub={calConnected ? 'Connected' : 'Not connected'}
            right={calConnected ? <Btn size="sm" variant="soft" onClick={() => { window.location.href = '/api/auth/google/disconnect' }}>Disconnect</Btn> : <Btn size="sm" onClick={() => { window.location.href = '/api/auth/google' }}>Connect</Btn>}
          />
          {calConnected && <Row icon="sync" title="Auto-sync sessions" right={<Toggle on={settings.calendarSync} onChange={calendarSync => updateSettings({ calendarSync })} />} />}
          {calConnected && <Row icon="cloud" title="Manual sync" sub="Sync recent unsynced sessions" last right={<Btn size="sm" variant="outline" disabled={manualSyncBusy} onClick={manualSync}>{manualSyncBusy ? 'Syncing...' : 'Sync'}</Btn>} />}
        </Group>
        {syncNotice && <p className={`-mt-4 mb-[22px] px-1 text-[13px] ${syncNotice.type === 'success' ? 'text-[#3F9142]' : 'text-[#C2615A]'}`}>{syncNotice.message}</p>}

        <Group label="Notifications">
          <Row icon="sound" title="Sound" right={<Toggle on={settings.soundEnabled} onChange={soundEnabled => updateSettings({ soundEnabled })} />} />
          <Row icon="shield" title="Keep screen awake" sub="Only while a session is running" right={<Toggle on={settings.keepScreenAwake} onChange={keepScreenAwake => updateSettings({ keepScreenAwake })} />} />
          <PushNotificationToggle />
        </Group>

        <Group label="Appearance">
          <Row icon={settings.darkMode ? 'moon' : 'sun'} title="Dark mode" right={<Toggle on={settings.darkMode} onChange={darkMode => updateSettings({ darkMode })} />} />
          <Row
            icon="circle"
            title="Accent"
            last
            right={
              <div className="flex gap-2">
                {ACCENT_OPTIONS.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => updateSettings({ accentColor: color })}
                    className="h-[24px] w-[24px] rounded-full p-0"
                    style={{ background: color, border: settings.accentColor === color ? '2px solid var(--ink)' : '2px solid transparent' }}
                  />
                ))}
              </div>
            }
          />
        </Group>

        <Group label="Account">
          <Row icon="sync" title="Sync" sub="Last synced just now" last right={<span className="text-[13px] font-semibold text-[var(--accent-ink)]">On</span>} />
        </Group>

        <div className="mt-1 flex flex-col gap-[10px]">
          <Btn full variant="soft" onClick={() => { window.location.href = '/api/logout' }}>Sign out</Btn>
        </div>
        <div className="mt-[14px] flex justify-center"><Wordmark size={18} /></div>
      </div>

      <CategorySheet open={catSheet} onClose={() => setCatSheet(false)} />
    </div>
  )
}
