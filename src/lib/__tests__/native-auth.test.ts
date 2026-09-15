import { describe, expect, it } from 'vitest'
import { createSessionToken, readBearerToken, readSessionToken } from '@/lib/app-auth'
import { validateTodoistAuth } from '@/lib/todoist-auth'

const config = {
  username: 'ivan',
  password: 'secret-pass',
  secret: 'top-secret-signing-key',
}

describe('readBearerToken', () => {
  it('reads the token out of an Authorization header', () => {
    expect(readBearerToken('Bearer abc.def')).toBe('abc.def')
    expect(readBearerToken('bearer abc.def')).toBe('abc.def')
    expect(readBearerToken('  Bearer   abc.def  ')).toBe('abc.def')
  })

  it('ignores anything that is not a bearer token', () => {
    expect(readBearerToken(null)).toBeNull()
    expect(readBearerToken('')).toBeNull()
    expect(readBearerToken('Basic abc')).toBeNull()
    expect(readBearerToken('Bearer')).toBeNull()
    expect(readBearerToken('Bearer    ')).toBeNull()
  })
})

describe('readSessionToken', () => {
  it('returns when a valid token expires, so a client can refresh in time', async () => {
    const token = await createSessionToken('ivan', config)
    const payload = await readSessionToken(token, config)
    expect(payload?.username).toBe('ivan')
    expect(payload?.expiresAt).toBeGreaterThan(Date.now())
  })

  it('refuses a token signed with a different secret', async () => {
    const token = await createSessionToken('ivan', config)
    expect(await readSessionToken(token, { ...config, secret: 'other-key' })).toBeNull()
  })

  it('refuses a tampered payload', async () => {
    const token = await createSessionToken('ivan', config)
    const [, signature] = token.split('.')
    const forged = `${btoa('root\t99999999999999').replace(/=+$/, '')}.${signature}`
    expect(await readSessionToken(forged, config)).toBeNull()
  })

  it('refuses an expired token', async () => {
    // Built by hand: createSessionToken only ever mints future expiries.
    const payload = btoa('ivan\t1').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(config.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    expect(await readSessionToken(`${payload}.${hex}`, config)).toBeNull()
  })
})

describe('validateTodoistAuth with a native client', () => {
  const env = process.env

  // Awaited inside the try: restoring the environment before the call that
  // reads it would leave every one of these testing an unconfigured server.
  async function withAuthEnv<T>(run: () => Promise<T>): Promise<T> {
    process.env = { ...env, APP_AUTH_USERNAME: config.username, APP_AUTH_PASSWORD: config.password, NEXTAUTH_SECRET: config.secret }
    try {
      return await run()
    } finally {
      process.env = env
    }
  }

  it('accepts an app session token in place of the page-visit cookie', async () => {
    // The cookie is only ever minted on an HTML navigation, which a native app
    // never performs — without this it could not reach a single task route.
    const result = await withAuthEnv(async () => {
      const token = await createSessionToken('ivan', config)
      return validateTodoistAuth(new Request('https://sesh.example/api/things/tasks', {
        headers: { authorization: `Bearer ${token}` },
      }))
    })
    expect(result.ok).toBe(true)
  })

  it('still refuses a request carrying neither', async () => {
    const result = await withAuthEnv(async () =>
      validateTodoistAuth(new Request('https://sesh.example/api/things/tasks')))
    expect(result.ok).toBe(false)
  })

  it('refuses a bearer token that is not ours', async () => {
    const result = await withAuthEnv(async () => {
      const token = await createSessionToken('ivan', { ...config, secret: 'someone-elses-key' })
      return validateTodoistAuth(new Request('https://sesh.example/api/things/tasks', {
        headers: { authorization: `Bearer ${token}` },
      }))
    })
    expect(result.ok).toBe(false)
  })

  it('keeps the cross-origin check for browser mutations', async () => {
    const result = await withAuthEnv(async () => {
      const token = await createSessionToken('ivan', config)
      return validateTodoistAuth(new Request('https://sesh.example/api/things/tasks', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example', host: 'sesh.example' },
      }))
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('Origin mismatch')
  })
})
