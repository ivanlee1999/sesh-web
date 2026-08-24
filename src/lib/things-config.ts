import 'server-only'
import { getDb } from './server-db'
import type { ThingsConnection } from './things'

/**
 * Where the live Things connection came from.
 *
 * `app` means somebody saved it in Settings; because it lives in the shared
 * SQLite database, every device sees the same connection with no per-device
 * setup. `env` is the older deployment style (THINGS_API_URL in .env.local),
 * kept working so an existing install keeps syncing after an upgrade.
 */
export type ThingsConfigSource = 'app' | 'env'

export interface ResolvedThingsConfig extends ThingsConnection {
  source: ThingsConfigSource
}

/** What the browser is allowed to know: everything except the key itself. */
export interface ThingsConfigView {
  configured: boolean
  source: ThingsConfigSource | null
  url: string
  hasKey: boolean
}

interface Row {
  api_url: string
  api_key: string
  updated_at: number
}

function readRow(): Row {
  const db = getDb()
  return db.prepare('SELECT api_url, api_key, updated_at FROM things_config WHERE id = 1').get() as Row
    ?? { api_url: '', api_key: '', updated_at: 0 }
}

function envConnection(): ThingsConnection | null {
  const url = process.env.THINGS_API_URL?.trim()
  if (!url) return null
  return { url, apiKey: process.env.THINGS_API_KEY?.trim() ?? '' }
}

/**
 * The connection to use, or null when Things is not set up at all.
 *
 * An in-app connection wins over the environment: saving one in Settings is a
 * deliberate, more recent act than whatever the container was started with.
 */
export function readThingsConfig(): ResolvedThingsConfig | null {
  const row = readRow()
  const url = row.api_url.trim()
  if (url) return { url, apiKey: row.api_key, source: 'app' }

  const env = envConnection()
  return env ? { ...env, source: 'env' } : null
}

export function readThingsConfigView(): ThingsConfigView {
  const config = readThingsConfig()
  if (!config) return { configured: false, source: null, url: '', hasKey: false }
  return { configured: true, source: config.source, url: config.url, hasKey: Boolean(config.apiKey) }
}

export class ThingsConfigError extends Error {}

/**
 * Accepts what a person would paste — a bare host, a trailing slash, extra
 * whitespace — and normalises it, rather than rejecting it on a technicality.
 */
export function normalizeThingsUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new ThingsConfigError('Enter the Things service URL.')

  // Only a genuinely scheme-less value gets http:// added. Testing for http(s)
  // alone would turn "ftp://host" into "http://ftp://host", which parses as
  // host "ftp" and would then sail past the protocol check below.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`)
  } catch {
    throw new ThingsConfigError('That does not look like a URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ThingsConfigError('The URL must start with http:// or https://.')
  }
  // Credentials in the URL would be stored in the clear and logged by the
  // sidecar; the API key field is the supported way to authenticate.
  if (parsed.username || parsed.password) {
    throw new ThingsConfigError('Put the key in the API key field, not in the URL.')
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`
}

/**
 * `apiKey: undefined` keeps whatever key is already stored, so editing just
 * the URL does not force the key to be retyped.
 */
export function saveThingsConfig(url: string, apiKey?: string): ResolvedThingsConfig {
  const normalized = normalizeThingsUrl(url)
  const existing = readRow()
  const nextKey = apiKey === undefined ? existing.api_key : apiKey.trim()

  getDb()
    .prepare('UPDATE things_config SET api_url = ?, api_key = ?, updated_at = ? WHERE id = 1')
    .run(normalized, nextKey, Date.now())

  return { url: normalized, apiKey: nextKey, source: 'app' }
}

/**
 * Forgets the in-app connection. If the deployment also has THINGS_API_URL set,
 * Things stays available through that — the caller should say so.
 */
export function clearThingsConfig(): void {
  getDb()
    .prepare("UPDATE things_config SET api_url = '', api_key = '', updated_at = ? WHERE id = 1")
    .run(Date.now())
}
