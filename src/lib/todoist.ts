/**
 * Server-side Todoist API v1 helper.
 * All calls require TODOIST_API_TOKEN in env.
 */

const TODOIST_BASE_URL = 'https://api.todoist.com/api/v1'

// ---------------------------------------------------------------------------
// Per-task mutex to prevent read-modify-write races in addTaskDuration.
// ---------------------------------------------------------------------------
const taskLocks = new Map<string, Promise<void>>()

/**
 * Serialize async work per task ID.  Callers `await` the returned promise;
 * while one call is in flight, subsequent calls for the same task queue
 * behind it rather than running concurrently.
 */
function withTaskLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  const prev = taskLocks.get(taskId) ?? Promise.resolve()
  const next = prev.then(fn, fn) // run fn regardless of previous outcome
  // Store the "settling" promise (without value) so the next caller chains
  const settle = next.then(
    () => {},
    () => {},
  )
  taskLocks.set(taskId, settle)
  // Clean up when idle to avoid unbounded map growth
  settle.then(() => {
    if (taskLocks.get(taskId) === settle) {
      taskLocks.delete(taskId)
    }
  })
  return next
}

function authHeaders(): Record<string, string> {
  const token = process.env.TODOIST_API_TOKEN
  if (!token) throw new Error('TODOIST_NOT_CONFIGURED')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export function isTodoistConfigured(): boolean {
  return Boolean(process.env.TODOIST_API_TOKEN)
}

export interface TodoistTaskRaw {
  id: string
  content: string
  duration: { amount: number; unit: string } | null
  labels: string[]
  priority: number
}

export async function listTodayTasks(): Promise<TodoistTaskRaw[]> {
  // Todoist API v1 moved filtered queries to POST /tasks/filter
  const res = await fetch(`${TODOIST_BASE_URL}/tasks/filter`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ query: 'today' }),
  })
  if (!res.ok) {
    throw new Error(`Todoist API error: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  // v1 returns { results: [...] }
  return (data.results ?? data) as TodoistTaskRaw[]
}

export async function getTask(id: string): Promise<TodoistTaskRaw> {
  const res = await fetch(`${TODOIST_BASE_URL}/tasks/${id}`, {
    headers: authHeaders(),
  })
  if (!res.ok) {
    throw new Error(`Todoist API error: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as TodoistTaskRaw
}

export async function closeTask(id: string): Promise<void> {
  const res = await fetch(`${TODOIST_BASE_URL}/tasks/${id}/close`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) {
    throw new Error(`Todoist API error: ${res.status} ${res.statusText}`)
  }
}

export async function setTaskDuration(id: string, totalMinutes: number): Promise<void> {
  const res = await fetch(`${TODOIST_BASE_URL}/tasks/${id}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      duration: { amount: totalMinutes, unit: 'minute' },
    }),
  })
  if (!res.ok) {
    throw new Error(`Todoist API error: ${res.status} ${res.statusText}`)
  }
}

/**
 * Add minutes to a task's duration. If the task has no duration, sets it.
 * Returns the new total minutes.
 *
 * Uses a per-task mutex so that concurrent calls for the same task ID are
 * serialized, preventing the read-modify-write race where two callers
 * both read the same old value and the last write overwrites the other.
 */
export function addTaskDuration(id: string, addMinutes: number): Promise<number> {
  return withTaskLock(id, async () => {
    const task = await getTask(id)
    const currentMinutes = task.duration?.unit === 'minute' ? task.duration.amount : 0
    const totalMinutes = currentMinutes + addMinutes
    await setTaskDuration(id, totalMinutes)
    return totalMinutes
  })
}
