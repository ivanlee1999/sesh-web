import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Next.js middleware — sets the Todoist proxy auth cookie on every page
 * navigation so that subsequent /api/todoist/* calls can prove the caller
 * has actually visited the app.
 *
 * Uses the Web Crypto API (Edge-compatible) for HMAC signing.
 * The Todoist route handlers validate the cookie via `validateTodoistAuth()`.
 */

const COOKIE_NAME = 'todoist_proxy_auth'

const SECRET = process.env.NEXTAUTH_SECRET || ''

// ---------------------------------------------------------------------------
// Web Crypto HMAC helpers (Edge Runtime compatible)
// ---------------------------------------------------------------------------

let _cryptoKey: CryptoKey | null = null

async function getCryptoKey(): Promise<CryptoKey> {
  if (_cryptoKey) return _cryptoKey
  const enc = new TextEncoder()
  _cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return _cryptoKey
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmac(value: string): Promise<string> {
  const key = await getCryptoKey()
  const enc = new TextEncoder()
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value))
  return toHex(sig)
}

async function generateToken(): Promise<string> {
  const ts = Date.now().toString()
  const sig = await hmac(ts)
  return `${ts}.${sig}`
}

async function isValidToken(token: string): Promise<boolean> {
  const dotIdx = token.indexOf('.')
  if (dotIdx === -1) return false
  const ts = token.slice(0, dotIdx)
  const sig = token.slice(dotIdx + 1)
  if (!ts || !sig) return false
  const expected = await hmac(ts)
  if (expected.length !== sig.length) return false
  // Constant-time comparison
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  return diff === 0
}

export async function middleware(request: NextRequest) {
  // Only set the cookie on navigational (page) requests, not API calls.
  const sfm = request.headers.get('sec-fetch-mode')
  const isPageRequest =
    sfm === 'navigate' ||
    // Fallback: accept text/html requests (covers older browsers)
    (request.headers.get('accept') ?? '').includes('text/html')

  if (!isPageRequest) return NextResponse.next()

  // If the visitor already has a valid cookie, leave it alone.
  const existing = request.cookies.get(COOKIE_NAME)?.value
  if (existing && (await isValidToken(existing))) {
    return NextResponse.next()
  }

  // Set a fresh auth cookie.
  const response = NextResponse.next()
  response.cookies.set(COOKIE_NAME, await generateToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    // Long-lived — reissued on each page visit anyway.
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}

/**
 * Only run on paths that could be page navigations or Todoist API calls.
 * This keeps the middleware out of static asset requests.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest).*)'],
}
