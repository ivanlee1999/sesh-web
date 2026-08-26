'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, type Session } from '@/types'
import { useSettings } from '@/context/SettingsContext'
import { useCategories } from '@/context/CategoriesContext'
import { CATEGORY_PALETTE } from '@/lib/categories'
import { isAuthResponse, readApiError, redirectToLogin } from '@/lib/api-client'
import { clearPushSubscriptionConfirmed, ensurePushSubscription, isPushSupported } from '@/lib/push-client'
import { PROVIDER_COLOR, isTodoistEnabled } from '@/lib/task-sources'
import { ACCENT_OPTIONS, Btn, Group, Icon, Row, ScreenHead, Sheet, Stepper, Toggle, Wordmark, fmtHM } from './sesh-ui'

type TodoistConnection =
  | { kind: 'checking'; message: string }
  | { kind: 'connected'; message: string }
  | { kind: 'not_configured'; message: string }
  | { kind: 'auth_required'; message: string }
  | { kind: 'error'; message: string }

/** Mirrors the safe view from /api/things/config — never carries the API key. */
type ThingsConfigView = {
  configured: boolean
  /** 'cloud' = signed in to Things directly; the others go via a companion service. */
  mode: 'cloud' | 'sidecar' | 'env' | null
  email: string
  url: string
  hasKey: boolean
}

/** The same view plus the liveness probe, as /api/things/status returns it. */
type ThingsStatusPayload = Partial<ThingsConfigView> & { reachable?: boolean; authFailed?: boolean }

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
      {error && <div className="anim-fade-up mt-3 text-[13px] text-[var(--warn)]">{error}</div>}
      <div className="mt-[14px]"><Btn full size="lg" onClick={onClose}>Done</Btn></div>
    </Sheet>
  )
}

/**
 * Things 3 connection editor.
 *
 * sesh reaches Things through a `things-cloud` sidecar; this points sesh at it.
 * Sign in with a Things account and sesh talks to Things Cloud itself — there
 * is nothing else to run. The account is saved on the server, not in this
 * browser, so connecting on one device connects all of them.
 *
 * The companion-service fields are still here, folded away, for installs that
 * were set up that way before sesh could sign in on its own.
 */
function ThingsSheet({
  open,
  config,
  onClose,
  onSaved,
}: {
  open: boolean
  config: ThingsConfigView | null
  onClose: () => void
  /** Called with the fresh state, or with nothing to ask for a re-check. */
  onSaved: (view?: ThingsStatusPayload) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Read through a ref so the reset below can depend on `open` alone. Keying it
  // on `config` would re-run on every refresh of the parent's status object and
  // wipe the "Connected" message the save just produced.
  const configRef = useRef(config)
  configRef.current = config

  useEffect(() => {
    if (!open) return
    const current = configRef.current
    setEmail(current?.email ?? '')
    setPassword('')
    setUrl(current?.url ?? '')
    setApiKey('')
    setKeyTouched(false)
    // Only start on the companion-service form if that is what is in use.
    setAdvanced(current?.mode === 'sidecar' || current?.mode === 'env')
    setNotice(null)
  }, [open])

  const save = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/things/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Omitting apiKey keeps the stored one; sending '' clears it.
        body: JSON.stringify(advanced
          ? (keyTouched ? { url, apiKey } : { url })
          : { email, password }),
      })
      if (isAuthResponse(res)) return redirectToLogin()
      if (!res.ok) {
        setNotice({ type: 'error', message: await readApiError(res, 'Could not save the Things connection') })
        return
      }
      // The response already describes the saved state; hand it straight up
      // rather than re-fetching, which would race the write we just made.
      const data: ThingsStatusPayload = await res.json()
      onSaved(data)
      setPassword('')
      setNotice(data.reachable
        ? { type: 'success', message: 'Connected. Your Things tasks will show up in Tasks.' }
        : { type: 'error', message: advanced
          ? 'Saved, but the service did not answer. Check the address and that it is running.'
          : 'Saved, but Things did not answer. Try again in a moment.' })
    } catch (err) {
      setNotice({ type: 'error', message: err instanceof Error ? err.message : 'Could not save the Things connection' })
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/things/config', { method: 'DELETE' })
      if (isAuthResponse(res)) return redirectToLogin()
      if (!res.ok) {
        setNotice({ type: 'error', message: await readApiError(res, 'Could not disconnect Things') })
        return
      }
      const data: ThingsConfigView = await res.json()
      // No payload: whether the env fallback (if any) is live needs a real probe.
      onSaved()
      setUrl(data.url)
      setNotice({
        type: 'success',
        message: data.configured
          ? 'Removed. Still connected through the server environment.'
          : 'Disconnected.',
      })
    } catch (err) {
      setNotice({ type: 'error', message: err instanceof Error ? err.message : 'Could not disconnect Things' })
    } finally {
      setBusy(false)
    }
  }

  const fieldClass = 'w-full rounded-[var(--r-md)] border-[1.5px] border-[var(--line-strong)] bg-[var(--surface)] px-[14px] py-[11px] text-[16px] font-semibold tracking-[-0.01em] text-[var(--ink)] outline-none'

  return (
    <Sheet open={open} onClose={onClose} title="Things 3">
      <p className="mx-0.5 mb-[18px] mt-0 text-[13.5px] leading-normal text-[var(--ink-3)]">
        {advanced
          ? 'Point sesh at a companion service that mirrors Things Cloud.'
          : 'Sign in with your Things account. It is saved on the server, so every device you use is connected at once.'}
      </p>

      {!advanced && (
        <>
          <label className="mb-[14px] block">
            <span className="mb-1.5 block text-[12.5px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">Things account email</span>
            <input
              autoFocus
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !busy) save() }}
              placeholder="you@example.com"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">Password</span>
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !busy) save() }}
              placeholder={config?.mode === 'cloud' ? 'Saved — enter it again to change accounts' : 'Your Things Cloud password'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={fieldClass}
            />
            <span className="mt-1.5 block px-0.5 text-[12.5px] leading-normal text-[var(--ink-3)]">
              Stored encrypted on your own server and sent only to Things.
            </span>
          </label>
        </>
      )}

      {advanced && (
      <>
      <label className="mb-[14px] block">
        <span className="mb-1.5 block text-[12.5px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">Service address</span>
        <input
          autoFocus
          value={url}
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !busy) save() }}
          placeholder="http://sesh-things-cloud:8080"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={fieldClass}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={event => { setApiKey(event.target.value); setKeyTouched(true) }}
          onKeyDown={event => { if (event.key === 'Enter' && !busy) save() }}
          placeholder={config?.hasKey ? 'Saved — leave blank to keep it' : 'Optional'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={fieldClass}
        />
        <span className="mt-1.5 block px-0.5 text-[12.5px] leading-normal text-[var(--ink-3)]">
          Only needed if the companion service runs with an API key set.
        </span>
      </label>
      </>
      )}

      {config?.mode === 'env' && (
        <p className="mx-0.5 mb-0 mt-[14px] text-[12.5px] leading-normal text-[var(--ink-3)]">
          Currently using THINGS_API_URL from the server environment. Saving here replaces it for every device.
        </p>
      )}

      {notice && (
        <p className={`anim-fade-up mx-0.5 mb-0 mt-[14px] text-[13px] leading-normal ${notice.type === 'success' ? 'text-[var(--good)]' : 'text-[var(--warn)]'}`}>
          {notice.message}
        </p>
      )}

      <div className="mt-[22px] flex flex-col gap-2">
        <Btn
          full
          size="lg"
          onClick={save}
          disabled={busy || (advanced ? !url.trim() : !email.trim() || !password)}
        >
          {busy ? (advanced ? 'Saving...' : 'Signing in...') : advanced ? 'Save and test' : 'Sign in'}
        </Btn>
        {(config?.mode === 'cloud' || config?.mode === 'sidecar') && (
          <Btn full variant="soft" onClick={disconnect} disabled={busy}>Disconnect</Btn>
        )}
        <button
          type="button"
          onClick={() => { setAdvanced(!advanced); setNotice(null) }}
          className="mt-1 border-0 bg-transparent p-1 text-[13px] font-medium text-[var(--ink-3)]"
        >
          {advanced ? 'Sign in with a Things account instead' : 'Use a companion service instead'}
        </button>
      </div>
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

/** Settings arrive from a generic key/value store, so treat every field as optional. */
function displayNameOf(settings: { displayName?: string }) {
  return settings.displayName?.trim() || DEFAULT_SETTINGS.displayName
}

function initialOf(settings: { displayName?: string }) {
  return displayNameOf(settings)[0].toUpperCase()
}

function ProfileScreen({ onBack }: { onBack: () => void }) {
  const { settings, updateSettings } = useSettings()
  const [sessions, setSessions] = useState<Session[]>([])
  const [stats, setStats] = useState<{ streak: number; todayMs: number } | null>(null)

  useEffect(() => {
    fetch('/api/sessions').then(res => res.ok ? res.json() : []).then(setSessions).catch(() => setSessions([]))
    fetch('/api/analytics').then(res => res.ok ? res.json() : null).then(setStats).catch(() => setStats(null))
  }, [])

  const totalMin = Math.round(sessions.filter(s => s.type === 'focus').reduce((sum, s) => sum + s.actualMs, 0) / 60000)

  return (
    <div className="anim-fade h-full w-full min-w-0 overflow-y-auto pb-[var(--screen-bottom-space)]">
      <div className="px-[var(--gutter)] pt-[calc(var(--screen-top)+34px+var(--safe-t))]">
        <button type="button" aria-label="Back to settings" onClick={onBack} className="press grid h-10 w-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]">
          <Icon name="back" size={20} />
        </button>
      </div>

      <div className="flex flex-col items-center px-[var(--gutter)] pb-[26px] pt-[22px] text-center">
        <div className="anim-pop grid h-[86px] w-[86px] place-items-center rounded-full bg-[var(--accent)] text-[36px] font-bold text-white">{initialOf(settings)}</div>
        <input
          value={settings.displayName ?? ''}
          onChange={event => updateSettings({ displayName: event.target.value })}
          aria-label="Display name"
          maxLength={32}
          className="mb-[3px] mt-4 w-full border-0 bg-transparent text-center font-[var(--font-display)] text-[25px] font-bold tracking-[-0.03em] text-[var(--ink)] outline-none"
        />
        <div className="text-[14.5px] text-[var(--ink-3)]">Private sesh workspace</div>
      </div>

      <div className="px-[var(--gutter)]">
        <div className="stagger mb-[22px] flex gap-3">
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
  const todoistOn = isTodoistEnabled(settings)
  const { categories } = useCategories()
  const [profile, setProfile] = useState(false)
  const [catSheet, setCatSheet] = useState(false)
  const [calConnected, setCalConnected] = useState(false)
  const [todoist, setTodoist] = useState<TodoistConnection>({ kind: 'checking', message: 'Checking Todoist...' })
  const [things, setThings] = useState<TodoistConnection>({ kind: 'checking', message: 'Checking Things...' })
  const [thingsConfig, setThingsConfig] = useState<ThingsConfigView | null>(null)
  const [thingsSheet, setThingsSheet] = useState(false)
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

  /** One place that turns a status payload into the row's state. */
  const applyThingsStatus = useCallback((data: ThingsStatusPayload) => {
    setThingsConfig({
      configured: !!data.configured,
      mode: data.mode ?? null,
      email: data.email ?? '',
      url: data.url ?? '',
      hasKey: !!data.hasKey,
    })
    if (!data.configured) {
      setThings({ kind: 'not_configured', message: 'Not connected' })
    } else if (data.authFailed) {
      setThings({ kind: 'error', message: 'Things rejected the saved password. Sign in again.' })
    } else if (!data.reachable) {
      setThings({
        kind: 'error',
        message: data.mode === 'cloud'
          ? 'Things Cloud is not answering right now.'
          : 'Service unreachable. Check the address and that it is running.',
      })
    } else if (data.mode === 'cloud') {
      setThings({ kind: 'connected', message: data.email ? `Connected as ${data.email}` : 'Connected' })
    } else {
      setThings({ kind: 'connected', message: data.mode === 'env' ? 'Connected via server config' : 'Connected' })
    }
  }, [])

  const checkThings = useCallback(async () => {
    setThings({ kind: 'checking', message: 'Checking Things...' })
    try {
      // no-store: a liveness probe served from the HTTP cache is worse than none.
      const res = await fetch('/api/things/status', { cache: 'no-store' })
      if (isAuthResponse(res)) {
        setThings({ kind: 'auth_required', message: 'Auth required. Sign in again to use Things.' })
        return
      }
      if (!res.ok) {
        setThings({ kind: 'error', message: await readApiError(res, 'Things status check failed') })
        return
      }
      applyThingsStatus(await res.json())
    } catch (err) {
      setThings({ kind: 'error', message: err instanceof Error ? err.message : 'Things status check failed' })
    }
  }, [applyThingsStatus])

  const handleThingsSaved = useCallback((view?: ThingsStatusPayload) => {
    if (view) applyThingsStatus(view)
    else void checkThings()
  }, [applyThingsStatus, checkThings])

  // Nothing to check while it is off, and no reason to call Todoist either.
  // Depends on the value, not the settings object: the object's identity is
  // not guaranteed stable, and re-running this every render loops forever.
  useEffect(() => { if (todoistOn) void checkTodoist() }, [checkTodoist, todoistOn])
  useEffect(() => { void checkThings() }, [checkThings])

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
  // Switched off counts as no source, whatever the last check said.
  const todoistConnected = todoistOn && todoist.kind === 'connected'
  const thingsBusy = things.kind === 'checking'
  const thingsConnected = things.kind === 'connected'

  return (
    <div className="h-full w-full min-w-0 overflow-y-auto pb-[var(--screen-bottom-space)]">
      <ScreenHead title="Settings" />
      <div className="px-[var(--gutter)] py-4">
        <button type="button" onClick={() => setProfile(true)} className="press anim-fade-up mb-[22px] flex w-full items-center gap-[15px] rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-[18px] py-4 text-left">
          <div className="grid h-[52px] w-[52px] flex-shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[21px] font-bold text-white">{initialOf(settings)}</div>
          <div className="flex-1">
            <div className="text-[17px] font-bold tracking-[-0.02em]">{displayNameOf(settings)}</div>
            <div className="text-[13.5px] text-[var(--ink-3)]">Private sesh workspace</div>
          </div>
          <Icon name="chevron" size={18} color="var(--ink-3)" />
        </button>

        <div className="card-grid stagger">
        <Group label="Timer">
          <Row icon="timer" title="Focus length" right={<Stepper value={settings.focusDuration} min={5} max={60} step={5} onChange={focusDuration => updateSettings({ focusDuration })} />} />
          <Row icon="leaf" title="Break length" right={<Stepper value={settings.breakDuration} min={1} max={30} onChange={breakDuration => updateSettings({ breakDuration })} />} />
          <Row icon="leaf" title="Long break length" right={<Stepper value={settings.longBreakDuration} min={5} max={45} step={5} onChange={longBreakDuration => updateSettings({ longBreakDuration })} />} />
          <Row icon="sync" title="Long break after" sub="Focus sessions per cycle" right={<Stepper value={settings.sessionsBeforeLongBreak} min={2} max={8} unit={settings.sessionsBeforeLongBreak === 1 ? 'session' : 'sessions'} onChange={sessionsBeforeLongBreak => updateSettings({ sessionsBeforeLongBreak })} />} />
          <Row icon="bell" title="Auto-start breaks" sub="Begin a break when focus ends" right={<Toggle on={settings.autoStartBreak} onChange={autoStartBreak => updateSettings({ autoStartBreak })} />} />
          <Row icon="play" title="Auto-start focus" sub="Begin the next focus when a break ends" last right={<Toggle on={settings.autoStartFocus} onChange={autoStartFocus => updateSettings({ autoStartFocus })} />} />
        </Group>

        <div>
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
        <div className="mt-[10px]">
          <Btn full variant="soft" icon="plus" size="sm" onClick={() => setCatSheet(true)}>Manage categories</Btn>
        </div>
        </div>

        <div className="card-span-2">
        <Group label="Integrations">
          <Row
            icon="list"
            title="Todoist"
            sub={todoistOn ? todoist.message : 'Off — not used for tasks'}
            right={
              <div className="flex items-center gap-2">
                {todoistOn && (
                  <Btn
                    size="sm"
                    variant={todoistConnected ? 'soft' : 'outline'}
                    disabled={todoistBusy}
                    onClick={todoist.kind === 'auth_required' ? () => redirectToLogin() : checkTodoist}
                  >
                    {todoistBusy ? 'Checking...' : todoist.kind === 'auth_required' ? 'Sign in' : 'Check'}
                  </Btn>
                )}
                <Toggle
                  on={todoistOn}
                  onChange={todoistEnabled => updateSettings({ todoistEnabled })}
                />
              </div>
            }
          />
          <Row
            icon="list"
            title={<span className="flex items-center gap-2">Things 3<span className="h-2 w-2 rounded-full" style={{ background: PROVIDER_COLOR.things }} /></span>}
            sub={things.message}
            right={
              <Btn
                size="sm"
                variant={thingsConnected ? 'soft' : 'outline'}
                disabled={thingsBusy}
                onClick={things.kind === 'auth_required' ? () => redirectToLogin() : () => setThingsSheet(true)}
              >
                {thingsBusy ? 'Checking...' : things.kind === 'auth_required' ? 'Sign in' : thingsConfig?.configured ? 'Edit' : 'Connect'}
              </Btn>
            }
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
        {syncNotice && <p className={`anim-fade-up mt-3 px-1 text-[13px] ${syncNotice.type === 'success' ? 'text-[var(--good)]' : 'text-[var(--warn)]'}`}>{syncNotice.message}</p>}
        </div>

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
                    aria-label={`Accent ${color}`}
                    onClick={() => updateSettings({ accentColor: color })}
                    className="press-sm h-[24px] w-[24px] rounded-full p-0"
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

        </div>

        <div className="mt-1 flex flex-col gap-[10px]">
          <Btn full variant="soft" onClick={() => { window.location.href = '/api/logout' }}>Sign out</Btn>
        </div>
        <div className="mt-[14px] flex justify-center"><Wordmark size={18} /></div>
      </div>

      <CategorySheet open={catSheet} onClose={() => setCatSheet(false)} />
      <ThingsSheet
        open={thingsSheet}
        config={thingsConfig}
        onClose={() => setThingsSheet(false)}
        onSaved={handleThingsSaved}
      />
    </div>
  )
}
