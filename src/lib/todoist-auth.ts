/**
 * Session-cookie auth for Todoist proxy routes.
 *
 * The app has no traditional user auth (it is a single-user personal tool),
 * but the Todoist proxy exposes the server's bearer token.  To prevent
 * external callers from abusing the proxy we:
 *
 *  1. Set an HMAC-signed httpOnly cookie on every page visit (via middleware).
 *  2. Require that cookie on every /api/todoist/* call.
 *  3. Validate the Origin header on state-changing (POST) requests to block
 *     cross-origin CSRF.
 *
 * This ensures that only browsers that have actually loaded the app can talk
 * to the proxy, and cross-site requests are rejected.
 */

import crypto from 'crypto'

const COOKIE_NAME = 'todoist_proxy_auth'

/**
 * Signing secret — prefer the explicit env var, fall back to a random value
 * that survives for the lifetime of the server process.
 */
const SECRET =
  process.env.NEXTAUTH_SECRET ||
  crypto.randomBytes(32).toString('hex')

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function hmac(value: string): string {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex')
}

/** Create a signed token: `timestamp.signature` */
export function generateToken(): string {
  const ts = Date.now().toString()
  return `${ts}.${hmac(ts)}`
}

/** Validate that a token was signed by us. */
function isValidToken(token: string): boolean {
  const dotIdx = token.indexOf('.')
  if (dotIdx === -1) return false
  const ts = token.slice(0, dotIdx)
  const sig = token.slice(dotIdx + 1)
  if (!ts || !sig) return false
  // Constant-time comparison to prevent timing attacks
  const expected = hmac(ts)
  if (expected.length !== sig.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
}

// ---------------------------------------------------------------------------
// Request-level auth
// ---------------------------------------------------------------------------

function getCookie(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

export interface AuthResult {
  ok: boolean
  /** If !ok, a short reason suitable for a JSON error response. */
  reason?: string
}

/**
 * Validate that the request carries a valid session cookie (all methods) and,
 * for state-changing methods, that the Origin matches the Host.
 */
export function validateTodoistAuth(request: Request): AuthResult {
  // 1. Cookie check — proves the caller has loaded the app
  const token = getCookie(request)
  if (!token || !isValidToken(token)) {
    return { ok: false, reason: 'Missing or invalid session' }
  }

  // 2. Origin / CSRF check for mutations
  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin')
    if (origin) {
      // Compare origin against the Host header (or X-Forwarded-Host behind a proxy)
      const host =
        request.headers.get('x-forwarded-host') || request.headers.get('host')
      if (host) {
        try {
          const originHost = new URL(origin).host
          if (originHost !== host) {
            return { ok: false, reason: 'Origin mismatch' }
          }
        } catch {
          return { ok: false, reason: 'Invalid Origin header' }
        }
      }
    }
    // If there is no Origin header at all we still allow the request because
    // same-origin fetch()es in some browsers omit it.  The cookie check
    // already proves the caller loaded our app.
  }

  return { ok: true }
}

export { COOKIE_NAME }
