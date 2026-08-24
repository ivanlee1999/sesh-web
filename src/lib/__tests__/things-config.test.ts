import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// server-only throws at import time outside a server environment.
vi.mock('server-only', () => ({}))

/**
 * Stands in for the single-row things_config table. Only the statements the
 * module actually issues are recognised, so a change in SQL shows up as a test
 * failure rather than silently passing.
 */
const row = {
  api_url: '',
  api_key: '',
  email: '',
  password_enc: '',
  history_key: '',
  updated_at: 0,
}

vi.mock('../server-db', () => ({
  getDb: () => ({
    prepare(sql: string) {
      const flat = sql.replace(/\s+/g, ' ').trim()
      if (flat.startsWith('SELECT')) return { get: () => ({ ...row }) }
      if (flat.startsWith('UPDATE things_config SET api_url = ?, api_key = ?, email')) {
        return {
          run: (url: string, key: string, at: number) => {
            Object.assign(row, { api_url: url, api_key: key, email: '', password_enc: '', history_key: '', updated_at: at })
          },
        }
      }
      if (flat.startsWith('UPDATE things_config SET email = ?, password_enc = ?')) {
        return {
          run: (email: string, enc: string, historyKey: string, at: number) => {
            Object.assign(row, { email, password_enc: enc, history_key: historyKey, api_url: '', api_key: '', updated_at: at })
          },
        }
      }
      if (flat.startsWith('UPDATE things_config SET history_key = ?')) {
        return { run: (historyKey: string) => { row.history_key = historyKey } }
      }
      if (flat.startsWith("UPDATE things_config SET api_url = '', api_key = '', email = ''")) {
        return {
          run: (at: number) => {
            Object.assign(row, { api_url: '', api_key: '', email: '', password_enc: '', history_key: '', updated_at: at })
          },
        }
      }
      throw new Error(`unexpected SQL: ${flat}`)
    },
  }),
}))

const verifyAccount = vi.fn(async (creds: { email: string; password: string }) => ({
  email: creds.email,
  historyKey: 'history-1',
}))

vi.mock('../things-cloud', () => ({
  verifyAccount: (creds: { email: string; password: string }) => verifyAccount(creds),
}))

const ORIGINAL_ENV = { ...process.env }

async function load() {
  return import('../things-config')
}

beforeEach(() => {
  Object.assign(row, { api_url: '', api_key: '', email: '', password_enc: '', history_key: '', updated_at: 0 })
  verifyAccount.mockClear()
  delete process.env.THINGS_API_URL
  delete process.env.THINGS_API_KEY
  process.env.NEXTAUTH_SECRET = 'test-secret'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('normalizeThingsUrl', () => {
  it('adds a scheme to a bare host and drops trailing slashes', async () => {
    const { normalizeThingsUrl } = await load()
    expect(normalizeThingsUrl(' sesh-things-cloud:8080/ ')).toBe('http://sesh-things-cloud:8080')
    expect(normalizeThingsUrl('https://things.example/base/')).toBe('https://things.example/base')
  })

  it('rejects blank input, non-http schemes and embedded credentials', async () => {
    const { normalizeThingsUrl, ThingsConfigError } = await load()
    expect(() => normalizeThingsUrl('   ')).toThrow(ThingsConfigError)
    expect(() => normalizeThingsUrl('ftp://things.example')).toThrow(ThingsConfigError)
    expect(() => normalizeThingsUrl('http://user:pw@things.example')).toThrow(/API key field/)
  })
})

describe('readThingsConfig', () => {
  it('is unconfigured with no account, no service and no env vars', async () => {
    const { readThingsConfig } = await load()
    expect(readThingsConfig()).toBeNull()
  })

  it('falls back to the server environment so existing installs keep working', async () => {
    process.env.THINGS_API_URL = 'http://env-host:8080'
    process.env.THINGS_API_KEY = 'env-key'
    const { readThingsConfig } = await load()
    expect(readThingsConfig()).toEqual({ mode: 'env', url: 'http://env-host:8080', apiKey: 'env-key' })
  })

  it('prefers a saved service over the environment', async () => {
    process.env.THINGS_API_URL = 'http://env-host:8080'
    const { saveThingsConfig, readThingsConfig } = await load()
    saveThingsConfig('http://app-host:9090', 'app-key')
    expect(readThingsConfig()).toEqual({ mode: 'sidecar', url: 'http://app-host:9090', apiKey: 'app-key' })
  })

  it('prefers a signed-in account over everything else', async () => {
    process.env.THINGS_API_URL = 'http://env-host:8080'
    const { saveThingsAccount, readThingsConfig } = await load()
    await saveThingsAccount('me@example.com', 'hunter2')
    expect(readThingsConfig()).toEqual({
      mode: 'cloud',
      credentials: { email: 'me@example.com', password: 'hunter2' },
      historyKey: 'history-1',
    })
  })
})

describe('saveThingsAccount', () => {
  it('verifies the credentials before storing them', async () => {
    const { saveThingsAccount } = await load()
    await saveThingsAccount(' me@example.com ', 'hunter2')
    expect(verifyAccount).toHaveBeenCalledWith({ email: 'me@example.com', password: 'hunter2' })
  })

  it('does not store the password in clear text', async () => {
    const { saveThingsAccount } = await load()
    await saveThingsAccount('me@example.com', 'hunter2')
    expect(row.password_enc).not.toContain('hunter2')
    expect(row.password_enc.length).toBeGreaterThan(0)
  })

  it('refuses a blank email or password without calling out', async () => {
    const { saveThingsAccount, ThingsConfigError } = await load()
    await expect(saveThingsAccount('  ', 'pw')).rejects.toThrow(ThingsConfigError)
    await expect(saveThingsAccount('me@example.com', '')).rejects.toThrow(ThingsConfigError)
    expect(verifyAccount).not.toHaveBeenCalled()
  })

  it('replaces a service connection, so only one is ever live', async () => {
    const { saveThingsConfig, saveThingsAccount, readThingsConfig } = await load()
    saveThingsConfig('http://app-host:9090', 'app-key')
    await saveThingsAccount('me@example.com', 'hunter2')
    expect(readThingsConfig()).toMatchObject({ mode: 'cloud' })
  })
})

describe('saveThingsConfig', () => {
  it('normalises the URL it stores', async () => {
    const { saveThingsConfig } = await load()
    expect(saveThingsConfig('app-host:9090/', 'k').url).toBe('http://app-host:9090')
  })

  it('keeps the stored key when none is supplied', async () => {
    const { saveThingsConfig, readThingsConfig } = await load()
    saveThingsConfig('http://a:1', 'keep-me')
    saveThingsConfig('http://b:2')
    expect(readThingsConfig()).toMatchObject({ url: 'http://b:2', apiKey: 'keep-me' })
  })

  it('clears the key when an empty string is supplied', async () => {
    const { saveThingsConfig, readThingsConfig } = await load()
    saveThingsConfig('http://a:1', 'drop-me')
    saveThingsConfig('http://a:1', '')
    expect(readThingsConfig()).toMatchObject({ apiKey: '' })
  })
})

describe('readThingsConfigView', () => {
  it('reports the account without disclosing the password', async () => {
    const { saveThingsAccount, readThingsConfigView } = await load()
    await saveThingsAccount('me@example.com', 'super-secret')
    const view = readThingsConfigView()
    expect(view).toEqual({ configured: true, mode: 'cloud', email: 'me@example.com', url: '', hasKey: true })
    expect(JSON.stringify(view)).not.toContain('super-secret')
  })

  it('reports that a service key exists without disclosing it', async () => {
    const { saveThingsConfig, readThingsConfigView } = await load()
    saveThingsConfig('http://a:1', 'super-secret')
    const view = readThingsConfigView()
    expect(view).toEqual({ configured: true, mode: 'sidecar', email: '', url: 'http://a:1', hasKey: true })
    expect(JSON.stringify(view)).not.toContain('super-secret')
  })
})

describe('clearThingsConfig', () => {
  it('drops the saved connection', async () => {
    const { saveThingsAccount, clearThingsConfig, readThingsConfig } = await load()
    await saveThingsAccount('me@example.com', 'hunter2')
    clearThingsConfig()
    expect(readThingsConfig()).toBeNull()
  })

  it('reveals the environment connection again when one is set', async () => {
    process.env.THINGS_API_URL = 'http://env-host:8080'
    const { saveThingsConfig, clearThingsConfig, readThingsConfig } = await load()
    saveThingsConfig('http://a:1', 'k')
    clearThingsConfig()
    expect(readThingsConfig()).toMatchObject({ url: 'http://env-host:8080', mode: 'env' })
  })
})

describe('an unreadable stored password', () => {
  it('falls through instead of throwing, so the UI can ask again', async () => {
    const { saveThingsAccount, readThingsConfig } = await load()
    await saveThingsAccount('me@example.com', 'hunter2')
    // Simulates a rotated NEXTAUTH_SECRET: the ciphertext no longer decrypts.
    process.env.NEXTAUTH_SECRET = 'a-different-secret'
    expect(readThingsConfig()).toBeNull()
  })
})
