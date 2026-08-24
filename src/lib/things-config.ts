import 'server-only'
import { getDb } from './server-db'
import type { ThingsConnection } from './things'
import { verifyAccount, type ThingsCredentials } from './things-cloud'
import { decryptSecret, encryptSecret } from './things-secret'

/**
 * How sesh reaches Things, in priority order.
 *
 * `cloud` is the direct connection: sesh signs in to Things Cloud itself with
 * an email and password, so there is nothing else to run. `sidecar` is the
 * older shape, pointing sesh at a things-cloud companion service, kept working
 * for installs that already had one. `env` is the same thing configured through
 * THINGS_API_URL instead of the UI.
 *
 * All of them live server-side, so every device shares one connection.
 */
export type ThingsMode = 'cloud' | 'sidecar' | 'env'

export interface CloudConfig {
  mode: 'cloud'
  credentials: ThingsCredentials
  historyKey: string
}

export interface SidecarConfig extends ThingsConnection {
  mode: 'sidecar' | 'env'
}

export type ResolvedThingsConfig = CloudConfig | SidecarConfig

/** What the browser is allowed to know: never the password. */
export interface ThingsConfigView {
  configured: boolean
  mode: ThingsMode | null
  email: string
  url: string
  hasKey: boolean
}

interface Row {
  api_url: string
  api_key: string
  email: string
  password_enc: string
  history_key: string
}

function readRow(): Row {
  return getDb()
    .prepare('SELECT api_url, api_key, email, password_enc, history_key FROM things_config WHERE id = 1')
    .get() as Row ?? { api_url: '', api_key: '', email: '', password_enc: '', history_key: '' }
}

function envConnection(): ThingsConnection | null {
  const url = process.env.THINGS_API_URL?.trim()
  if (!url) return null
  return { url, apiKey: process.env.THINGS_API_KEY?.trim() ?? '' }
}

/**
 * The connection to use, or null when Things is not set up.
 *
 * A saved account wins over a sidecar, and either wins over the environment:
 * anything configured in the app is a more recent, more deliberate act than
 * whatever the container was started with.
 */
export function readThingsConfig(): ResolvedThingsConfig | null {
  const row = readRow()

  const email = row.email.trim()
  if (email && row.password_enc) {
    const password = decryptSecret(row.password_enc)
    // A rotated NEXTAUTH_SECRET makes the stored password unreadable. Fall
    // through rather than throw, so the UI can ask for it again.
    if (password) {
      return { mode: 'cloud', credentials: { email, password }, historyKey: row.history_key }
    }
  }

  const url = row.api_url.trim()
  if (url) return { mode: 'sidecar', url, apiKey: row.api_key }

  const env = envConnection()
  return env ? { mode: 'env', ...env } : null
}

export function readThingsConfigView(): ThingsConfigView {
  const config = readThingsConfig()
  if (!config) return { configured: false, mode: null, email: '', url: '', hasKey: false }
  if (config.mode === 'cloud') {
    return { configured: true, mode: 'cloud', email: config.credentials.email, url: '', hasKey: true }
  }
  return { configured: true, mode: config.mode, email: '', url: config.url, hasKey: Boolean(config.apiKey) }
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
 * Signs in to Things Cloud and stores the account. Verification happens first:
 * saving credentials that don't work would leave Things looking connected and
 * quietly failing on every request.
 */
export async function saveThingsAccount(email: string, password: string): Promise<CloudConfig> {
  const trimmedEmail = email.trim()
  if (!trimmedEmail) throw new ThingsConfigError('Enter the email address for your Things account.')
  if (!password) throw new ThingsConfigError('Enter your Things password.')

  const account = await verifyAccount({ email: trimmedEmail, password })

  getDb().prepare(`
    UPDATE things_config
    SET email = ?, password_enc = ?, history_key = ?, api_url = '', api_key = '', updated_at = ?
    WHERE id = 1
  `).run(account.email, encryptSecret(password), account.historyKey, Date.now())

  return { mode: 'cloud', credentials: { email: account.email, password }, historyKey: account.historyKey }
}

/**
 * `apiKey: undefined` keeps whatever key is already stored, so editing just
 * the URL does not force the key to be retyped.
 */
export function saveThingsConfig(url: string, apiKey?: string): SidecarConfig {
  const normalized = normalizeThingsUrl(url)
  const existing = readRow()
  const nextKey = apiKey === undefined ? existing.api_key : apiKey.trim()

  getDb().prepare(`
    UPDATE things_config
    SET api_url = ?, api_key = ?, email = '', password_enc = '', history_key = '', updated_at = ?
    WHERE id = 1
  `).run(normalized, nextKey, Date.now())

  return { mode: 'sidecar', url: normalized, apiKey: nextKey }
}

/** Remembers the account's stream id so a later sync skips the lookup. */
export function rememberHistoryKey(historyKey: string) {
  getDb().prepare('UPDATE things_config SET history_key = ? WHERE id = 1').run(historyKey)
}

/**
 * Forgets the in-app connection. If the deployment also has THINGS_API_URL set,
 * Things stays available through that — the caller should say so.
 */
export function clearThingsConfig(): void {
  getDb().prepare(`
    UPDATE things_config
    SET api_url = '', api_key = '', email = '', password_enc = '', history_key = '', updated_at = ?
    WHERE id = 1
  `).run(Date.now())
}
