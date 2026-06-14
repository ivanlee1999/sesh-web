import {
  APP_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getAppAuthConfig,
  isAppAuthDisabled,
  isAuthorizedLogin,
  sanitizeNextPath,
  validateSessionToken,
} from '@/lib/app-auth'
import { describe, expect, it } from 'vitest'

const env = {
  APP_AUTH_USERNAME: 'ivan',
  APP_AUTH_PASSWORD: 'secret-pass',
  NEXTAUTH_SECRET: 'top-secret-signing-key',
}

describe('app-auth', () => {
  it('reads auth config from env', () => {
    expect(getAppAuthConfig(env)).toEqual({
      username: 'ivan',
      password: 'secret-pass',
      secret: 'top-secret-signing-key',
    })
  })

  it('supports legacy basic auth env names as fallback', () => {
    expect(
      getAppAuthConfig({
        BASIC_AUTH_USERNAME: 'legacy-user',
        BASIC_AUTH_PASSWORD: 'legacy-pass',
        NEXTAUTH_SECRET: 'legacy-secret',
      }),
    ).toEqual({
      username: 'legacy-user',
      password: 'legacy-pass',
      secret: 'legacy-secret',
    })
  })

  it('authorizes only exact matching credentials', () => {
    const config = getAppAuthConfig(env)
    expect(config).not.toBeNull()
    expect(isAuthorizedLogin('ivan', 'secret-pass', config!)).toBe(true)
    expect(isAuthorizedLogin('ivan', 'wrong', config!)).toBe(false)
    expect(isAuthorizedLogin('wrong', 'secret-pass', config!)).toBe(false)
  })

  it('creates a valid signed session token', async () => {
    const config = getAppAuthConfig(env)
    expect(config).not.toBeNull()
    const token = await createSessionToken('ivan', config!)

    expect(await validateSessionToken(token, config!)).toBe(true)
  })

  it('rejects tampered session tokens', async () => {
    const config = getAppAuthConfig(env)
    expect(config).not.toBeNull()
    const token = await createSessionToken('ivan', config!)
    expect(await validateSessionToken(`${token}x`, config!)).toBe(false)
  })

  it('parses auth disable flags', () => {
    expect(isAppAuthDisabled(undefined)).toBe(false)
    expect(isAppAuthDisabled('true')).toBe(true)
    expect(isAppAuthDisabled('ON')).toBe(true)
  })

  it('sanitizes next paths', () => {
    expect(sanitizeNextPath('/settings')).toBe('/settings')
    expect(sanitizeNextPath('//evil.com')).toBe('/')
    expect(sanitizeNextPath('/login?next=/')).toBe('/')
    expect(sanitizeNextPath('https://evil.com')).toBe('/')
  })

  it('uses a long-lived but bounded session', () => {
    expect(APP_SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30)
  })
})
