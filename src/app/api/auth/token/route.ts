import { NextResponse } from 'next/server'
import {
  APP_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getAppAuthConfig,
  getAppAuthDisableEnv,
  isAppAuthDisabled,
  isAuthorizedLogin,
  readBearerToken,
  readSessionToken,
} from '@/lib/app-auth'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * The session token, for clients that cannot hold a cookie.
 *
 * `/api/login` answers a form with a redirect and a `Set-Cookie`, which is
 * exactly wrong for a native app: it wants the token itself, in JSON, to put
 * in the keychain. The token minted here is the same value the cookie carries
 * and is validated by the same code, so a phone and a browser are the same
 * kind of signed-in.
 *
 * Two ways in:
 *  - credentials, the first time;
 *  - a still-valid bearer token, to get a fresh one before the old expires.
 * The second means the app never has to keep the password on the device.
 */
export async function POST(request: Request) {
  if (isAppAuthDisabled(getAppAuthDisableEnv(process.env))) {
    // Nothing to prove. Say so rather than mint a token the server would then
    // ignore, so the client knows not to bother sending one.
    return NextResponse.json({ authDisabled: true, token: '', expiresAt: 0 }, { headers: NO_STORE })
  }

  const config = getAppAuthConfig(process.env)
  if (!config) {
    return NextResponse.json(
      { error: 'App auth is enabled but credentials are not fully configured' },
      { status: 503, headers: NO_STORE },
    )
  }

  const existing = await readSessionToken(readBearerToken(request.headers.get('authorization')) ?? undefined, config)
  if (!existing) {
    const body = await request.json().catch(() => ({})) as { username?: unknown; password?: unknown }
    const username = typeof body.username === 'string' ? body.username : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!isAuthorizedLogin(username, password, config)) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401, headers: NO_STORE })
    }
  }

  const token = await createSessionToken(config.username, config)
  const issued = await readSessionToken(token, config)

  return NextResponse.json(
    {
      token,
      // Read back off the token rather than recomputed, so the client's idea of
      // when to refresh cannot drift from the server's idea of when to refuse.
      expiresAt: issued?.expiresAt ?? Date.now() + APP_SESSION_MAX_AGE_SECONDS * 1000,
      username: config.username,
    },
    { headers: NO_STORE },
  )
}
