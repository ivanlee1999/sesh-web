/**
 * Simple in-memory rate limiter for Todoist proxy routes.
 *
 * This prevents unauthenticated callers from abusing the server's
 * Todoist bearer token.  The approach mirrors the push-subscribe
 * rate limiter already used elsewhere in the codebase.
 */

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30 // generous for normal UI use, tight enough to deter abuse

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return '127.0.0.1'
}

export function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX
}
