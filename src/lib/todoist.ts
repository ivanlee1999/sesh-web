/**
 * Server-side Todoist API v1 helper.
 * All calls require TODOIST_API_TOKEN in env.
 */

const TODOIST_BASE_URL = 'https://api.todoist.com/api/v1'

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
 */
export async function addTaskDuration(id: string, addMinutes: number): Promise<number> {
  const task = await getTask(id)
  const currentMinutes = task.duration?.unit === 'minute' ? task.duration.amount : 0
  const totalMinutes = currentMinutes + addMinutes
  await setTaskDuration(id, totalMinutes)
  return totalMinutes
}
