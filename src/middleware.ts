import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  APP_SESSION_COOKIE,
  getAppAuthConfig,
  getAppAuthDisableEnv,
  isAppAuthDisabled,
  sanitizeNextPath,
  validateSessionToken,
} from '@/lib/app-auth'

/**
 * Next.js middleware — protects the app with a shared session login and
 * sets the Todoist proxy auth cookie on page navigations so subsequent
 * /api/todoist/* calls can prove the caller has actually visited the app.
 *
 * Uses the Web Crypto API (Edge-compatible) for HMAC signing.
 * The Todoist route handlers validate the cookie via `validateTodoistAuth()`.
 */

const COOKIE_NAME = 'todoist_proxy_auth'
const TODOIST_SECRET = process.env.NEXTAUTH_SECRET || ''

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/login',
  '/favicon.ico',
  '/manifest.json',
  '/sw.js',
  '/icons/',
  '/_next/static/',
  '/_next/image/',
]

let cryptoKey: CryptoKey | null = null

async function getCryptoKey(): Promise<CryptoKey> {
  if (cryptoKey) return cryptoKey
  const enc = new TextEncoder()
  cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(TODOIST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return cryptoKey
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

async function generateTodoistToken(): Promise<string> {
  const ts = Date.now().toString()
  const sig = await hmac(ts)
  return `${ts}.${sig}`
}

async function isValidTodoistToken(token: string): Promise<boolean> {
  const dotIdx = token.indexOf('.')
  if (dotIdx === -1) return false
  const ts = token.slice(0, dotIdx)
  const sig = token.slice(dotIdx + 1)
  if (!ts || !sig) return false
  const expected = await hmac(ts)
  if (expected.length !== sig.length) return false

  let diff = 0
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  return diff === 0
}

function isPageRequest(request: NextRequest): boolean {
  const secFetchMode = request.headers.get('sec-fetch-mode')
  return (
    secFetchMode === 'navigate' ||
    (request.headers.get('accept') ?? '').includes('text/html')
  )
}

function isApiRequest(request: NextRequest): boolean {
  return request.nextUrl.pathname.startsWith('/api/')
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))
}

function loginRedirect(request: NextRequest): NextResponse {
  const url = new URL('/login', request.url)
  url.searchParams.set('next', sanitizeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`))
  const response = NextResponse.redirect(url)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function unauthorizedApiResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Authentication required' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  )
}

function missingConfigResponse(request: NextRequest): NextResponse {
  const payload = {
    error:
      'App auth is enabled but APP_AUTH_USERNAME/APP_AUTH_PASSWORD (or BASIC_AUTH_USERNAME/BASIC_AUTH_PASSWORD) and NEXTAUTH_SECRET are not fully configured',
  }

  if (isApiRequest(request)) {
    return NextResponse.json(payload, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  return new NextResponse(payload.error, {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function middleware(request: NextRequest) {
  if (!isAppAuthDisabled(getAppAuthDisableEnv(process.env))) {
    const pathname = request.nextUrl.pathname
    if (!isPublicPath(pathname)) {
      const authConfig = getAppAuthConfig(process.env)
      if (!authConfig) {
        return missingConfigResponse(request)
      }

      const sessionToken = request.cookies.get(APP_SESSION_COOKIE)?.value
      if (!(await validateSessionToken(sessionToken, authConfig))) {
        return isApiRequest(request) ? unauthorizedApiResponse() : loginRedirect(request)
      }
    }
  }

  if (!isPageRequest(request)) {
    return NextResponse.next()
  }

  if (!TODOIST_SECRET) {
    return NextResponse.next()
  }

  const existing = request.cookies.get(COOKIE_NAME)?.value
  if (existing && (await isValidTodoistToken(existing))) {
    return NextResponse.next()
  }

  const response = NextResponse.next()
  response.cookies.set(COOKIE_NAME, await generateTodoistToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
}
