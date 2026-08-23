import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { isThingsConfigured, verifyThings } from '@/lib/things'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = validateTodoistAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  if (!isThingsConfigured()) {
    return NextResponse.json({ configured: false, reachable: false })
  }
  // Configured but unreachable is a real state: the sidecar may be starting up
  // or its Things Cloud credentials may have gone stale.
  return NextResponse.json({ configured: true, reachable: await verifyThings() })
}
