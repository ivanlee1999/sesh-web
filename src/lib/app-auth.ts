export interface AppAuthConfig {
  username: string
  password: string
  secret: string
}

export const APP_SESSION_COOKIE = 'sesh_app_session'
export const APP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function isAppAuthDisabled(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function getAppAuthDisableEnv(env: NodeJS.ProcessEnv): string | undefined {
  return env.DISABLE_APP_AUTH || env.DISABLE_BASIC_AUTH
}

export function getAppAuthConfig(env: NodeJS.ProcessEnv): AppAuthConfig | null {
  const username = env.APP_AUTH_USERNAME?.trim() || env.BASIC_AUTH_USERNAME?.trim()
  const password = env.APP_AUTH_PASSWORD || env.BASIC_AUTH_PASSWORD
  const secret = env.APP_AUTH_SECRET || env.NEXTAUTH_SECRET

  if (!username || !password || !secret) {
    return null
  }

  return { username, password, secret }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return mismatch === 0
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return atob(normalized + padding)
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function isAuthorizedLogin(
  username: string | null | undefined,
  password: string | null | undefined,
  config: AppAuthConfig,
): boolean {
  if (!username || !password) return false

  return (
    constantTimeEqual(username, config.username) &&
    constantTimeEqual(password, config.password)
  )
}

export async function createSessionToken(username: string, config: AppAuthConfig): Promise<string> {
  const expiresAt = Date.now() + APP_SESSION_MAX_AGE_SECONDS * 1000
  const payload = `${username}\t${expiresAt}`
  const payloadEncoded = base64UrlEncode(payload)
  const signature = await hmac(payloadEncoded, config.secret)
  return `${payloadEncoded}.${signature}`
}

export interface SessionTokenPayload {
  username: string
  /** Epoch ms after which the token stops being accepted. */
  expiresAt: number
}

/**
 * The payload of a token that is genuinely ours and still valid, or null.
 *
 * Separate from {@link validateSessionToken} because a native client needs the
 * expiry back to know when to ask for a new one — a browser never had to, its
 * cookie simply stopped being sent.
 */
export async function readSessionToken(
  token: string | undefined,
  config: AppAuthConfig,
): Promise<SessionTokenPayload | null> {
  if (!token) return null

  const [payloadEncoded, signature] = token.split('.', 2)
  if (!payloadEncoded || !signature) return null

  const expectedSignature = await hmac(payloadEncoded, config.secret)
  if (!constantTimeEqual(signature, expectedSignature)) return null

  try {
    const payload = base64UrlDecode(payloadEncoded)
    const [username, expiresAtRaw] = payload.split('\t', 2)
    const expiresAt = Number(expiresAtRaw)
    if (!username || !Number.isFinite(expiresAt)) return null
    if (!constantTimeEqual(username, config.username)) return null
    if (expiresAt <= Date.now()) return null
    return { username, expiresAt }
  } catch {
    return null
  }
}

export async function validateSessionToken(
  token: string | undefined,
  config: AppAuthConfig,
): Promise<boolean> {
  return (await readSessionToken(token, config)) !== null
}

/**
 * The token a native client sends, which has no cookie jar to keep one in.
 *
 * The value is exactly the session cookie's: one token format, one validator,
 * so a phone and a browser cannot drift into different notions of who is
 * signed in.
 */
export function readBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null
  const value = authorization.trim()
  if (!value.toLowerCase().startsWith('bearer ')) return null
  return value.slice('bearer '.length).trim() || null
}

export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/')) return '/'
  if (next.startsWith('//')) return '/'
  if (next.startsWith('/login')) return '/'
  return next
}
