'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_SETTINGS } from '@/types'
import { useSettings } from '@/context/SettingsContext'
import { useCategories } from '@/context/CategoriesContext'
import { CATEGORY_PALETTE } from '@/lib/categories'
import { isAuthResponse, readApiError, redirectToLogin } from '@/lib/api-client'
import { clearPushSubscriptionConfirmed, ensurePushSubscription, isPushSupported } from '@/lib/push-client'
import { PROVIDER_COLOR, isTodoistEnabled } from '@/lib/task-sources'
import { SWATCHES } from '@/lib/modernist'
import { Btn, Icon, Sheet } from './sesh-ui'
import { useShellStatus } from './md/shell-status'

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


/** The swatch row inside the category sheet. `compact` shows only the current one. */
function ColorDots({ value, onChange, compact }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const colors = compact ? [value] : CATEGORY_PALETTE
  return (
    <div className="flex flex-wrap gap-[7px]">
      {colors.map(col => (
        <button
          key={col}
          type="button"
          aria-label={`Set colour ${col}`}
          onClick={() => onChange(col)}
          className="p-0"
          style={{
            width: compact ? 22 : 30,
            height: compact ? 22 : 30,
            background: col,
            border: value === col ? '2px solid var(--color-text)' : '2px solid transparent',
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

type Pane = 'timer' | 'alerts' | 'colours' | 'sources'

const PANES: { key: Pane; label: string }[] = [
  { key: 'timer', label: 'Timer' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'colours', label: 'Colours' },
  { key: 'sources', label: 'Sources' },
]

const quietStyle = (active: boolean): CSSProperties => ({
  border: `2px solid ${active ? 'var(--color-accent)' : 'var(--color-divider)'}`,
  background: active ? 'var(--color-accent)' : 'transparent',
  color: active ? '#fff' : 'inherit',
  padding: '6px 10px',
  cursor: 'pointer',
  fontFamily: 'var(--font-heading)',
  fontWeight: 800,
  fontSize: 10.5,
  letterSpacing: '.09em',
  textTransform: 'uppercase',
})

const PANE_HEAD: CSSProperties = {
  padding: '12px 18px 6px',
  fontFamily: 'var(--font-heading)',
  fontWeight: 800,
  fontSize: 11,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: 'var(--color-neutral-600)',
}

/** A square 52×28 track whose 18px knob moves by flipping the justification. */
function MdToggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className="md-press"
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      style={{
        flex: 'none',
        width: 52,
        height: 28,
        padding: 3,
        cursor: disabled ? 'default' : 'pointer',
        border: `2px solid ${on ? 'var(--color-accent)' : 'var(--color-divider)'}`,
        background: on ? 'var(--color-accent)' : 'transparent',
        display: 'flex',
        justifyContent: on ? 'flex-end' : 'flex-start',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 200ms, border-color 200ms',
      }}
    >
      <span
        style={{
          display: 'block',
          width: 18,
          height: 18,
          background: on ? '#fff' : 'var(--color-neutral-500)',
          transition: 'background 200ms',
        }}
      />
    </button>
  )
}

function MdStepper({
  label,
  value,
  onChange,
  min = 1,
  max = 90,
  step = 5,
  unit = 'min',
}: {
  label: string
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}) {
  return (
    <div className="md-hairline" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 18px' }}>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', border: '2px solid var(--color-divider)' }}>
        <button
          type="button"
          className="md-press md-lift"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          style={{ width: 34, height: 32, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 17, fontWeight: 700, lineHeight: 1 }}
        >
          −
        </button>
        {/* Keyed on the value so the pop replays on every change. */}
        <span
          key={value}
          className="md-numpop md-num"
          style={{
            minWidth: 62,
            textAlign: 'center',
            fontFamily: 'var(--font-heading)',
            fontWeight: 800,
            fontSize: 13,
            borderLeft: '2px solid var(--color-divider)',
            borderRight: '2px solid var(--color-divider)',
            padding: '8px 4px',
          }}
        >
          {value} {unit}
        </span>
        <button
          type="button"
          className="md-press md-lift"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          style={{ width: 34, height: 32, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 17, fontWeight: 700, lineHeight: 1 }}
        >
          +
        </button>
      </div>
    </div>
  )
}

function ToggleRow({
  title,
  sub,
  on,
  disabled,
  onChange,
}: {
  title: string
  sub: string
  on: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="md-hairline" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px' }}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{sub}</span>
      </span>
      <MdToggle on={on} disabled={disabled} onChange={onChange} label={title} />
    </div>
  )
}

/** The push row keeps its own permission/subscription state. */
function PushRow() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const init = async () => {
      const ok = isPushSupported()
      setSupported(ok)
      if (!ok) return
      setPermission(Notification.permission)
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setEnabled(!!sub)
        if (!sub) clearPushSubscriptionConfirmed()
      } catch {
        setEnabled(false)
        clearPushSubscriptionConfirmed()
      }
    }
    init()
  }, [])

  const toggle = async (next: boolean) => {
    setBusy(true)
    try {
      if (next) {
        const ok = await ensurePushSubscription({ requestPermission: true })
        setPermission(Notification.permission)
        setEnabled(ok)
      } else {
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
        setEnabled(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const sub = !supported
    ? 'Not supported in this browser'
    : permission === 'denied'
      ? 'Permission denied'
      : enabled ? 'Enabled · works installed' : 'Disabled'

  return (
    <ToggleRow
      title="Push alerts"
      sub={sub}
      on={enabled}
      disabled={!supported || permission === 'denied' || busy}
      onChange={toggle}
    />
  )
}

export default function Settings({ onReplayIntro }: { onReplayIntro?: () => void }) {
  const { settings, updateSettings } = useSettings()
  const todoistOn = isTodoistEnabled(settings)
  const { categories, updateCategory } = useCategories()
  const { reportSub } = useShellStatus()
  const [pane, setPane] = useState<Pane>('timer')
  const [calConnected, setCalConnected] = useState(false)
  const [todoist, setTodoist] = useState<TodoistConnection>({ kind: 'checking', message: 'Checking Todoist...' })
  const [things, setThings] = useState<TodoistConnection>({ kind: 'checking', message: 'Checking Things...' })
  const [thingsConfig, setThingsConfig] = useState<ThingsConfigView | null>(null)
  const [thingsSheet, setThingsSheet] = useState(false)
  const [catSheet, setCatSheet] = useState(false)
  const [manualSyncBusy, setManualSyncBusy] = useState(false)
  const [syncNotice, setSyncNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    reportSub('settings', 'Device + account')
  }, [reportSub])

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
      if (failed) throw new Error(failed.error ?? 'Calendar sync failed')

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

  /** Hand the session log back as a file, from the same endpoint the app reads. */
  const exportSessions = async () => {
    try {
      const res = await fetch('/api/sessions')
      if (!res.ok) throw new Error(await readApiError(res, 'Could not export sessions'))
      const data = await res.json()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `sesh-sessions-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setSyncNotice({ type: 'error', message: err instanceof Error ? err.message : 'Could not export sessions' })
    }
  }

  const todoistConnected = todoistOn && todoist.kind === 'connected'
  const thingsConnected = things.kind === 'connected'

  const sources = [
    {
      key: 'todoist',
      label: 'Todoist',
      dot: PROVIDER_COLOR.todoist,
      sub: todoistOn ? todoist.message : 'Switched off — not queried',
      // One action per row, so it offers whatever is actually useful next:
      // sign in when the session lapsed, otherwise the on/off switch. The
      // status re-probes on mount and whenever this flips, so a separate
      // "check" button would only ever repeat what just happened.
      cta: todoistOn && todoist.kind === 'auth_required' ? 'Sign in' : todoistOn ? 'On' : 'Off',
      on: todoistConnected,
      action: todoistOn && todoist.kind === 'auth_required'
        ? () => redirectToLogin()
        : () => updateSettings({ todoistEnabled: !todoistOn }),
    },
    {
      key: 'things',
      label: 'Things 3',
      dot: PROVIDER_COLOR.things,
      sub: things.message,
      cta: 'Manage',
      on: thingsConnected,
      action: () => setThingsSheet(true),
    },
    {
      key: 'calendar',
      label: 'Google Calendar',
      dot: '#4285F4',
      sub: calConnected ? 'Connected · mirrors finished sessions' : 'Not connected',
      cta: calConnected ? 'Disconnect' : 'Connect',
      on: calConnected,
      action: () => {
        window.location.href = calConnected ? '/api/auth/google/disconnect' : '/api/auth/google'
      },
    },
  ]

  return (
    <div className="md-screen md-screen-col">
      <h2 className="md-title" style={{ padding: '12px 18px 8px', fontSize: 24, flex: 'none' }}>Settings</h2>

      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          padding: '9px 18px 12px',
          borderBottom: '2px solid var(--color-divider)',
          flex: 'none',
        }}
      >
        {PANES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className="md-press"
            aria-pressed={pane === key}
            onClick={() => setPane(key)}
            style={quietStyle(pane === key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {pane === 'timer' && (
          <div>
            <div style={PANE_HEAD}>Durations</div>
            <MdStepper label="Focus length" value={settings.focusDuration} onChange={focusDuration => updateSettings({ focusDuration })} />
            <MdStepper label="Short break" value={settings.breakDuration} onChange={breakDuration => updateSettings({ breakDuration })} />
            <MdStepper label="Long break" value={settings.longBreakDuration} onChange={longBreakDuration => updateSettings({ longBreakDuration })} />
            <MdStepper
              label="Long break after"
              value={settings.sessionsBeforeLongBreak}
              min={2}
              max={8}
              step={1}
              unit={settings.sessionsBeforeLongBreak === 1 ? 'session' : 'sessions'}
              onChange={sessionsBeforeLongBreak => updateSettings({ sessionsBeforeLongBreak })}
            />
          </div>
        )}

        {pane === 'alerts' && (
          <div>
            <div style={PANE_HEAD}>Alerts &amp; appearance</div>
            <div className="md-hairline" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px' }}>
              <span style={{ flex: 'none', fontSize: 14, fontWeight: 500 }}>Your name</span>
              <input
                value={settings.displayName ?? ''}
                onChange={event => updateSettings({ displayName: event.target.value })}
                aria-label="Display name"
                maxLength={32}
                placeholder={displayNameOf(settings)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'right',
                  border: 0,
                  background: 'transparent',
                  color: 'inherit',
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 800,
                  fontSize: 16,
                  outline: 'none',
                }}
              />
            </div>
            <ToggleRow
              title="Completion sound"
              sub="Two-tone chime when a session lands"
              on={settings.soundEnabled}
              onChange={soundEnabled => updateSettings({ soundEnabled })}
            />
            <PushRow />
            <ToggleRow
              title="Mirror to Google Calendar"
              sub={calConnected ? 'Sessions appear as busy blocks' : 'Connect Calendar in Sources first'}
              on={settings.calendarSync}
              disabled={!calConnected}
              onChange={calendarSync => updateSettings({ calendarSync })}
            />
            <ToggleRow
              title="Dark interface"
              sub="Focus mode is always dark"
              on={settings.darkMode}
              onChange={darkMode => updateSettings({ darkMode })}
            />
            <ToggleRow
              title="Auto-start breaks"
              sub="Begin a break the moment focus ends"
              on={settings.autoStartBreak}
              onChange={autoStartBreak => updateSettings({ autoStartBreak })}
            />
            <ToggleRow
              title="Auto-start focus"
              sub="Begin the next focus when a break ends"
              on={settings.autoStartFocus}
              onChange={autoStartFocus => updateSettings({ autoStartFocus })}
            />
            <ToggleRow
              title="Keep screen awake"
              sub="Only while a session is running"
              on={settings.keepScreenAwake}
              onChange={keepScreenAwake => updateSettings({ keepScreenAwake })}
            />
          </div>
        )}

        {pane === 'colours' && (
          <div>
            <div style={PANE_HEAD}>Category colours</div>
            {categories.map(category => (
              <div
                key={category.id}
                className="md-hairline"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 18px' }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {category.label}
                </span>
                <div style={{ display: 'flex', gap: 5, flex: 'none' }}>
                  {SWATCHES.map(hex => {
                    const chosen = category.color.toLowerCase() === hex.toLowerCase()
                    return (
                      <button
                        key={hex}
                        type="button"
                        className="md-press"
                        aria-label={`Set ${category.label} to ${hex}`}
                        aria-pressed={chosen}
                        onClick={() => updateCategory(category.id, { color: hex })}
                        style={{
                          width: 22,
                          height: 22,
                          flex: 'none',
                          cursor: 'pointer',
                          background: hex,
                          border: chosen ? '2px solid var(--color-text)' : '2px solid transparent',
                          outline: chosen ? '2px solid var(--color-bg)' : 'none',
                          outlineOffset: -4,
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="md-press md-lift"
              onClick={() => setCatSheet(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '11px 18px',
                border: 0,
                background: 'transparent',
                color: 'var(--color-neutral-600)',
                cursor: 'pointer',
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: 11,
                letterSpacing: '.09em',
                textTransform: 'uppercase',
                textAlign: 'left',
              }}
            >
              Add or rename categories
            </button>
          </div>
        )}

        {pane === 'sources' && (
          <div>
            <div style={PANE_HEAD}>Task sources</div>
            {sources.map(source => (
              <div
                key={source.key}
                className="md-hairline"
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px' }}
              >
                <span style={{ width: 9, height: 9, background: source.dot, display: 'block', flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{source.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{source.sub}</span>
                </span>
                <button
                  type="button"
                  className="md-press"
                  onClick={source.action}
                  style={{
                    flex: 'none',
                    border: `2px solid ${source.on ? 'var(--color-accent)' : 'var(--color-divider)'}`,
                    background: 'transparent',
                    color: source.on ? 'var(--color-accent)' : 'var(--color-neutral-600)',
                    padding: '7px 11px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 800,
                    fontSize: 10.5,
                    letterSpacing: '.09em',
                    textTransform: 'uppercase',
                  }}
                >
                  {source.cta}
                </button>
              </div>
            ))}
            {calConnected && (
              <div className="md-hairline" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500 }}>Sync recent sessions now</span>
                <button
                  type="button"
                  className="md-press"
                  onClick={manualSync}
                  disabled={manualSyncBusy}
                  style={{
                    flex: 'none',
                    border: '2px solid var(--color-divider)',
                    background: 'transparent',
                    color: 'inherit',
                    padding: '7px 11px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 800,
                    fontSize: 10.5,
                    letterSpacing: '.09em',
                    textTransform: 'uppercase',
                    opacity: manualSyncBusy ? 0.5 : 1,
                  }}
                >
                  {manualSyncBusy ? 'Syncing…' : 'Sync'}
                </button>
              </div>
            )}
            {syncNotice && (
              <p
                style={{
                  margin: 0,
                  padding: '10px 18px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: syncNotice.type === 'success' ? 'var(--good)' : 'var(--color-accent)',
                }}
              >
                {syncNotice.message}
              </p>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 'auto',
          padding: '11px 18px calc(11px + var(--safe-b))',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 9,
          borderTop: '2px solid var(--color-divider)',
          flex: 'none',
        }}
      >
        <button
          type="button"
          className="md-press"
          onClick={() => onReplayIntro?.()}
          style={{
            border: '2px solid var(--color-divider)',
            background: 'transparent',
            color: 'inherit',
            padding: '9px 13px',
            cursor: 'pointer',
            fontFamily: 'var(--font-heading)',
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: '.09em',
            textTransform: 'uppercase',
          }}
        >
          Replay intro
        </button>
        <button
          type="button"
          className="md-press"
          onClick={exportSessions}
          style={{
            border: '2px solid var(--color-divider)',
            background: 'transparent',
            color: 'inherit',
            padding: '9px 13px',
            cursor: 'pointer',
            fontFamily: 'var(--font-heading)',
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: '.09em',
            textTransform: 'uppercase',
          }}
        >
          Export sessions
        </button>
        <button
          type="button"
          className="md-press"
          onClick={() => { window.location.href = '/api/logout' }}
          style={{
            border: '2px solid var(--color-accent)',
            background: 'transparent',
            color: 'var(--color-accent)',
            padding: '9px 13px',
            cursor: 'pointer',
            fontFamily: 'var(--font-heading)',
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: '.09em',
            textTransform: 'uppercase',
          }}
        >
          Sign out
        </button>
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
