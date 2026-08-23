/**
 * Server-side Things 3 helper.
 *
 * Things has no official API — Cultured Code has never published one. This
 * talks to a `things-cloud-mcp` sidecar (https://github.com/mattydsmith/things-cloud-mcp,
 * MIT), a Go service that mirrors Things Cloud into a local SQLite snapshot and
 * exposes a Bearer-auth REST API. It holds the Things Cloud credentials; sesh
 * only ever sees the sidecar.
 *
 * Because the sidecar rides on a reverse-engineered protocol, every call here
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
}

/** Views the sidecar exposes that map onto how sesh groups work. */
export type ThingsView = 'today' | 'inbox' | 'anytime' | 'upcoming' | 'someday'

function baseUrl(): string {
  const raw = process.env.THINGS_API_URL
  if (!raw) throw new Error('THINGS_NOT_CONFIGURED')
  return raw.replace(/\/+$/, '')
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = process.env.THINGS_API_KEY
  // The sidecar only enforces Bearer auth when it has API_KEY set.
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

export function isThingsConfigured(): boolean {
  return Boolean(process.env.THINGS_API_URL)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
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

export async function verifyThings(): Promise<boolean> {
  try {
    await request<unknown>('/api/verify')
    return true
  } catch {
    return false
  }
}

export async function listThingsView(view: ThingsView): Promise<ThingsTaskRaw[]> {
  return readTaskArray(await request<unknown>(`/api/tasks/${view}`))
}

/**
 * Everything actionable. Things' views are disjoint, so several are merged and
 * de-duplicated by uuid. A failing view yields nothing rather than blowing up
 * the whole list.
 */
export async function listThingsTasks(views: ThingsView[]): Promise<ThingsTaskRaw[]> {
  const results = await Promise.all(
    views.map(view => listThingsView(view).catch(() => [] as ThingsTaskRaw[])),
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

export async function completeThingsTask(uuid: string): Promise<void> {
  await request<unknown>('/api/tasks/complete', {
    method: 'POST',
    body: JSON.stringify({ uuid }),
  })
}

/**
 * Things has no duration field, so focused time is appended to the task note
 * instead. Best-effort: a failure here must not fail the session save.
 */
export async function appendThingsFocusNote(uuid: string, minutes: number): Promise<void> {
  await request<unknown>('/api/tasks/edit', {
    method: 'POST',
    body: JSON.stringify({ uuid, note: `Focused ${minutes}m via sesh` }),
  })
}
