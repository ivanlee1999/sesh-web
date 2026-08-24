import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { verifyThings } from '@/lib/things'
import { readThingsConfig, readThingsConfigView } from '@/lib/things-config'

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
  // Configured but unreachable is a real state: the sidecar may be starting up
  // or its Things Cloud credentials may have gone stale.
  const conn = readThingsConfig()
  return NextResponse.json({ ...view, reachable: conn ? await verifyThings(conn) : false }, NO_STORE)
}
