#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'

function cookieHeader(cookies) {
  return Array.from(cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ')
}

function storeCookies(headers, cookies) {
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean)

  for (const raw of setCookies) {
    const [pair] = raw.split(';', 1)
    const idx = pair.indexOf('=')
    if (idx > 0) cookies.set(pair.slice(0, idx), pair.slice(idx + 1))
  }
}

async function readBody(res) {
  const text = await res.text()
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}

async function request(baseUrl, path, options, cookies) {
  const headers = new Headers(options?.headers ?? {})
  if (cookies.size > 0) headers.set('cookie', cookieHeader(cookies))
  const res = await fetch(new URL(path, baseUrl), {
    ...options,
    headers,
    redirect: 'manual',
  })
  storeCookies(res.headers, cookies)
  return res
}

async function login(baseUrl, cookies, username, password) {
  const form = new URLSearchParams({ username, password, next: '/' })
  const res = await request(baseUrl, '/api/login', {
    method: 'POST',
    body: form,
  }, cookies)
  if (![303, 307, 308].includes(res.status)) {
    throw new Error(`Login failed: ${res.status} ${await readBody(res)}`)
  }
}

async function expectOk(label, res) {
  if (!res.ok) {
    throw new Error(`${label} failed: ${res.status} ${await readBody(res)}`)
  }
  await readBody(res)
}

export async function smokeRuntime({
  baseUrl = process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL,
  username = process.env.SMOKE_USERNAME || process.env.APP_AUTH_USERNAME || process.env.BASIC_AUTH_USERNAME,
  password = process.env.SMOKE_PASSWORD || process.env.APP_AUTH_PASSWORD || process.env.BASIC_AUTH_PASSWORD,
} = {}) {
  const cookies = new Map()

  if (username && password) {
    await login(baseUrl, cookies, username, password)
  }

  const endpoints = [
    ['GET /api/sessions', '/api/sessions', { method: 'GET' }],
    ['GET /api/analytics', '/api/analytics', { method: 'GET' }],
    ['GET /api/auth/google/status', '/api/auth/google/status', { method: 'GET' }],
    ['POST /api/calendar/sync-manual', '/api/calendar/sync-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 10 }),
    }],
  ]

  for (const [label, path, options] of endpoints) {
    await expectOk(label, await request(baseUrl, path, options, cookies))
    console.log(`ok ${label}`)
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  smokeRuntime().catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
