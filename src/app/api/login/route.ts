import { NextRequest, NextResponse } from 'next/server'
import {
  APP_SESSION_COOKIE,
  APP_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getAppAuthConfig,
  getAppAuthDisableEnv,
  isAppAuthDisabled,
  isAuthorizedLogin,
  sanitizeNextPath,
} from '@/lib/app-auth'

function isSecureRequest(request: NextRequest): boolean {
  return request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https'
}

function redirectToLogin(request: NextRequest, nextPath: string, error = false) {
  const url = new URL('/login', 'http://localhost')
  url.searchParams.set('next', nextPath)
  if (error) {
    url.searchParams.set('error', '1')
  }
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: `${url.pathname}${url.search}`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: NextRequest) {
  if (isAppAuthDisabled(getAppAuthDisableEnv(process.env))) {
    return new NextResponse(null, {
      status: 303,
      headers: {
        Location: '/',
        'Cache-Control': 'no-store',
      },
    })
  }

  const authConfig = getAppAuthConfig(process.env)
  if (!authConfig) {
    return NextResponse.json(
      { error: 'App auth is enabled but credentials are not fully configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const formData = await request.formData()
  const username = String(formData.get('username') ?? '')
  const password = String(formData.get('password') ?? '')
  const nextPath = sanitizeNextPath(String(formData.get('next') ?? '/'))

  if (!isAuthorizedLogin(username, password, authConfig)) {
    return redirectToLogin(request, nextPath, true)
  }

  const sessionToken = await createSessionToken(username, authConfig)
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: nextPath,
    },
  })

  response.cookies.set(APP_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: '/',
    maxAge: APP_SESSION_MAX_AGE_SECONDS,
  })

  return response
}
