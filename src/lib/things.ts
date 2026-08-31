/**
 * Things 3 through a companion service.
 *
 * This is the older of the two connections — sesh now talks to Things Cloud
 * itself (see things-cloud), and this path is kept for installs already running
 * a `things-cloud-mcp` sidecar (https://github.com/mattydsmith/things-cloud-mcp,
 * MIT), a Go service that mirrors Things Cloud and exposes a Bearer-auth REST
 * API. It holds the Things Cloud credentials; sesh only ever sees the sidecar.
 *
 * Either way the underlying protocol is reverse-engineered, so every call here
 * fails soft: a Things outage must never take the Tasks tab down for Todoist.
 */

const DEFAULT_TIMEOUT_MS = 8000

export interface ThingsTaskRaw {
  uuid?: string
  id?: string
  title?: string
  name?: string
  note?: string
  notes?: string
  /** ISO date (YYYY-MM-DD) the task is scheduled for. */
  start_date?: string | null
  startDate?: string | null
  scheduled?: string | null
  deadline?: string | null
  due_date?: string | null
  /** Enclosing project / area names, used as the group heading. */
  project_title?: string | null
  projectTitle?: string | null
  area_title?: string | null
  areaTitle?: string | null
  tags?: string[] | null
  completed?: boolean
  status?: string | null
  /** Which Things list this sits in, when the connection can say. */
  view?: 'today' | 'inbox' | 'anytime' | 'upcoming' | 'someday' | null
}

/** Views the sidecar exposes that map onto how sesh groups work. */
export type ThingsView = 'today' | 'inbox' | 'anytime' | 'upcoming' | 'someday'

/**
 * Where the sidecar lives and how to authenticate to it. Passed in rather than
 * read from the environment here: the connection is configurable in Settings
 * and stored in the database (see lib/things-config), so only the caller knows
 * which one applies.
 */
export interface ThingsConnection {
  url: string
  /** Empty when the sidecar runs without API_KEY set. */
  apiKey: string
}

function baseUrl(conn: ThingsConnection): string {
  if (!conn.url) throw new Error('THINGS_NOT_CONFIGURED')
  return conn.url.replace(/\/+$/, '')
}

function authHeaders(conn: ThingsConnection): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // The sidecar only enforces Bearer auth when it has API_KEY set.
  if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`
  return headers
}

async function request<T>(conn: ThingsConnection, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl(conn)}${path}`, {
      ...init,
      headers: { ...authHeaders(conn), ...(init?.headers ?? {}) },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`Things API error: ${res.status} ${res.statusText}`)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Things API timed out')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

/** The sidecar returns either a bare array or `{ tasks: [...] }` depending on the route. */
function readTaskArray(payload: unknown): ThingsTaskRaw[] {
  if (Array.isArray(payload)) return payload as ThingsTaskRaw[]
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of ['tasks', 'items', 'results', 'data']) {
      if (Array.isArray(record[key])) return record[key] as ThingsTaskRaw[]
    }
  }
  return []
}

export async function verifyThings(conn: ThingsConnection): Promise<boolean> {
  try {
    await request<unknown>(conn, '/api/verify')
    return true
  } catch {
    return false
  }
}

export async function listThingsView(conn: ThingsConnection, view: ThingsView): Promise<ThingsTaskRaw[]> {
  return readTaskArray(await request<unknown>(conn, `/api/tasks/${view}`))
}

/**
 * Everything actionable. Things' views are disjoint, so several are merged and
 * de-duplicated by uuid. A failing view yields nothing rather than blowing up
 * the whole list.
 */
export async function listThingsTasks(conn: ThingsConnection, views: ThingsView[]): Promise<ThingsTaskRaw[]> {
  const results = await Promise.all(
    views.map(async view => {
      const tasks = await listThingsView(conn, view).catch(() => [] as ThingsTaskRaw[])
      // Tag as it arrives: the merge below drops duplicates, so afterwards
      // there is no way to tell which list a to-do came from.
      return tasks.map(task => ({ ...task, view: task.view ?? view }))
    }),
  )
  const seen = new Set<string>()
  const merged: ThingsTaskRaw[] = []
  for (const task of results.flat()) {
    const id = String(task.uuid ?? task.id ?? '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    merged.push(task)
  }
  return merged
}

export async function completeThingsTask(conn: ThingsConnection, uuid: string): Promise<void> {
  await request<unknown>(conn, '/api/tasks/complete', {
    method: 'POST',
    body: JSON.stringify({ uuid }),
  })
}

/**
 * Things has no duration field, so focused time is appended to the task note
 * instead. Best-effort: a failure here must not fail the session save.
 */
export async function appendThingsFocusNote(conn: ThingsConnection, uuid: string, minutes: number): Promise<void> {
  await request<unknown>(conn, '/api/tasks/edit', {
    method: 'POST',
    body: JSON.stringify({ uuid, note: `Focused ${minutes}m via sesh` }),
  })
}

/**
 * Create a to-do through the companion service.
 *
 * `when` is passed through as the service's own vocabulary (today, anytime,
 * someday, inbox) rather than translated to wire fields here — the service
 * owns that mapping, and duplicating it would be two things to keep in step.
 */
export async function createThingsTask(
  conn: ThingsConnection,
  input: { title: string; when: string },
): Promise<void> {
  await request<unknown>(conn, '/api/tasks/create', {
    method: 'POST',
    body: JSON.stringify({ title: input.title, when: input.when }),
  })
}
