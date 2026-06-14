import { NextRequest, NextResponse } from 'next/server'
import { APP_SESSION_COOKIE } from '@/lib/app-auth'

function isSecureRequest(request: NextRequest): boolean {
  return request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https'
}

function clearSessionResponse(request: NextRequest) {
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: '/login',
      'Cache-Control': 'no-store',
    },
  })
  response.cookies.set(APP_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}

export async function POST(request: NextRequest) {
  return clearSessionResponse(request)
}

export async function GET(request: NextRequest) {
  return clearSessionResponse(request)
}
