import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// server-only throws at import time outside a server environment.
vi.mock('server-only', () => ({}))

/**
 * Stands in for the single-row things_config table. Only the two statements the
 * module actually issues are recognised, so a change in SQL shows up as a test
 * failure rather than silently passing.
 */
const row = { api_url: '', api_key: '', updated_at: 0 }

vi.mock('../server-db', () => ({
  getDb: () => ({
    prepare(sql: string) {
      if (sql.startsWith('SELECT')) return { get: () => ({ ...row }) }
      if (sql.startsWith('UPDATE things_config SET api_url = ?, api_key = ?')) {
        return {
          run: (url: string, key: string, at: number) => {
            row.api_url = url
            row.api_key = key
            row.updated_at = at
          },
        }
      }
      if (sql.startsWith("UPDATE things_config SET api_url = '', api_key = ''")) {
        return {
          run: (at: number) => {
            row.api_url = ''
            row.api_key = ''
            row.updated_at = at
          },
        }
      }
      throw new Error(`unexpected SQL: ${sql}`)
    },
  }),
}))

const ORIGINAL_ENV = { ...process.env }

async function load() {
  return import('../things-config')
}

beforeEach(() => {
  row.api_url = ''
  row.api_key = ''
  row.updated_at = 0
  delete process.env.THINGS_API_URL
  delete process.env.THINGS_API_KEY
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
  it('is unconfigured with neither a saved row nor env vars', async () => {
    const { readThingsConfig } = await load()
    expect(readThingsConfig()).toBeNull()
  })

  it('falls back to the server environment so existing installs keep working', async () => {
    process.env.THINGS_API_URL = 'http://env-host:8080'
    process.env.THINGS_API_KEY = 'env-key'
    const { readThingsConfig } = await load()
    expect(readThingsConfig()).toEqual({ url: 'http://env-host:8080', apiKey: 'env-key', source: 'env' })
  })

  it('prefers a connection saved in the app over the environment', async () => {
    process.env.THINGS_API_URL = 'http://env-host:8080'
    const { saveThingsConfig, readThingsConfig } = await load()
    saveThingsConfig('http://app-host:9090', 'app-key')
    expect(readThingsConfig()).toEqual({ url: 'http://app-host:9090', apiKey: 'app-key', source: 'app' })
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
  it('reports that a key exists without disclosing it', async () => {
    const { saveThingsConfig, readThingsConfigView } = await load()
    saveThingsConfig('http://a:1', 'super-secret')
    const view = readThingsConfigView()
    expect(view).toEqual({ configured: true, source: 'app', url: 'http://a:1', hasKey: true })
    expect(JSON.stringify(view)).not.toContain('super-secret')
  })
})

describe('clearThingsConfig', () => {
  it('drops the saved connection', async () => {
    const { saveThingsConfig, clearThingsConfig, readThingsConfig } = await load()
    saveThingsConfig('http://a:1', 'k')
    clearThingsConfig()
    expect(readThingsConfig()).toBeNull()
  })

  it('reveals the environment connection again when one is set', async () => {
    process.env.THINGS_API_URL = 'http://env-host:8080'
    const { saveThingsConfig, clearThingsConfig, readThingsConfig } = await load()
    saveThingsConfig('http://a:1', 'k')
    clearThingsConfig()
    expect(readThingsConfig()).toMatchObject({ url: 'http://env-host:8080', source: 'env' })
  })
})
