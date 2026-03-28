import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

export const dynamic = 'force-dynamic'

/**
 * Maximum number of push subscriptions allowed in the database.
 * Prevents unbounded storage growth from unauthenticated callers.
 */
const MAX_SUBSCRIPTIONS = 25

/**
 * Simple in-memory rate limiter: max requests per window per IP.
 */
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 10 // max 10 subscribe calls per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }

  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  // Fallback — in practice Next.js will supply x-forwarded-for
  return '127.0.0.1'
}

/**
 * Only accept subscription endpoints that look like valid web push URLs.
 * Legitimate push services use HTTPS endpoints on well-known origins.
 */
function isValidPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const db = getDb()
  const body = await request.json()

  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  if (typeof endpoint !== 'string' || !isValidPushEndpoint(endpoint)) {
    return NextResponse.json({ error: 'Invalid push endpoint' }, { status: 400 })
  }

  if (typeof p256dh !== 'string' || typeof auth !== 'string') {
    return NextResponse.json({ error: 'Invalid subscription keys' }, { status: 400 })
  }

  // Check subscription cap (don't count if this endpoint already exists — upsert is fine)
  const existing = db
    .prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?')
    .get(endpoint) as unknown

  if (!existing) {
    const count = (
      db.prepare('SELECT COUNT(*) as cnt FROM push_subscriptions').get() as { cnt: number }
    ).cnt
    if (count >= MAX_SUBSCRIPTIONS) {
      return NextResponse.json(
        { error: 'Subscription limit reached' },
        { status: 403 }
      )
    }
  }

  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth
  `).run(endpoint, p256dh, auth, Math.floor(Date.now() / 1000))

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const ip = getClientIp(request)
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const db = getDb()
  const body = await request.json()
  const endpoint = body?.endpoint

  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
  }

  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
  return NextResponse.json({ ok: true })
}
