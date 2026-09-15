import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { GET as thingsStatus } from '@/app/api/things/status/route'
import { GET as thingsTasks } from '@/app/api/things/tasks/route'
import { GET as todoistStatus } from '@/app/api/todoist/status/route'
import { GET as todoistTasks } from '@/app/api/todoist/tasks/route'

export const dynamic = 'force-dynamic'

/**
 * Both task sources, and their connection state, in one request.
 *
 * The web app asks four questions to fill its list, which is fine over a warm
 * connection to a server it is already talking to. A phone refreshing a cache
 * it will then browse offline wants one round trip, and wants a partial answer
 * rather than none: Things being unreachable should not cost it the Todoist
 * list it could have had.
 *
 * Deliberately built by calling the existing handlers rather than
 * reimplementing them. The mapping into `ExternalTask`, the date bucketing
 * against the viewer's timezone, the sync-still-catching-up flag — all of that
 * is subtle, and a second copy of it would be wrong within a month.
 */
export async function GET(request: Request) {
  const auth = await validateTodoistAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = new URL(request.url).searchParams.get('tz') ?? ''
  const query = tz ? `?filter=all&tz=${encodeURIComponent(tz)}` : '?filter=all'

  const [things, todoist] = await Promise.all([
    collect(request, `/api/things/tasks${query}`, thingsTasks, '/api/things/status', thingsStatus),
    collect(request, `/api/todoist/tasks${query}`, todoistTasks, '/api/todoist/status', todoistStatus),
  ])

  return NextResponse.json(
    { fetchedAt: Date.now(), things, todoist },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

type Handler = (request: Request) => Promise<Response>

interface ProviderSnapshot {
  status: unknown
  tasks: unknown[]
  syncing?: boolean
  /** Set when this provider could not be read; the other one still is. */
  error?: string
}

async function collect(
  original: Request,
  tasksPath: string,
  tasksHandler: Handler,
  statusPath: string,
  statusHandler: Handler,
): Promise<ProviderSnapshot> {
  const status = await read(original, statusPath, statusHandler)
  const tasks = await read(original, tasksPath, tasksHandler)

  if (!tasks.ok) {
    return {
      status: status.ok ? status.body : null,
      tasks: [],
      error: readError(tasks.body) ?? `Request failed (${tasks.status})`,
    }
  }

  const body = tasks.body as { tasks?: unknown[]; syncing?: boolean }
  return {
    status: status.ok ? status.body : null,
    tasks: Array.isArray(body?.tasks) ? body.tasks : [],
    syncing: body?.syncing === true,
  }
}

/**
 * Re-issue one of our own GETs, carrying the caller's credentials so the
 * handler authenticates exactly as it would have directly.
 */
async function read(
  original: Request,
  path: string,
  handler: Handler,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const url = new URL(path, original.url)
    const headers = new Headers()
    for (const name of ['cookie', 'authorization', 'x-forwarded-for', 'x-real-ip', 'host', 'x-forwarded-host']) {
      const value = original.headers.get(name)
      if (value) headers.set(name, value)
    }
    const response = await handler(new Request(url, { method: 'GET', headers }))
    const body = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, body }
  } catch (err) {
    return { ok: false, status: 500, body: { error: err instanceof Error ? err.message : 'Unknown error' } }
  }
}

function readError(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const value = (body as { error: unknown }).error
    if (typeof value === 'string') return value
  }
  return undefined
}
