import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { readThingsConfig, readThingsConfigView } from '@/lib/things-config'
import { checkThings } from '@/lib/things-service'

export const dynamic = 'force-dynamic'

/**
 * `dynamic` only stops Next caching the render — without an explicit header the
 * browser may still serve a stale 200 from its own cache, which for a liveness
 * probe means reporting "not connected" seconds after a successful save.
 */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

export async function GET(request: Request) {
  const auth = validateTodoistAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const view = readThingsConfigView()
  if (!view.configured) {
    return NextResponse.json({ ...view, reachable: false }, NO_STORE)
  }
  // Configured but unreachable is a real state: Things Cloud may be down, or a
  // password may have been changed since it was saved.
  const config = readThingsConfig()
  const health = config ? await checkThings(config) : { reachable: false }
  return NextResponse.json({ ...view, ...health }, NO_STORE)
}
