'use client'

/**
 * Client-side facade over the external task providers.
 *
 * Todoist and Things are fetched independently and merged into one list. One
 * provider being down, unconfigured or slow must never hide the other, so every
 * call here resolves per provider and reports failures alongside the tasks that
 * did load.
 */

import type { ExternalTask, TaskProvider } from '@/types'
import { resolveProvider } from '@/types'
import { isAuthResponse, readApiError } from '@/lib/api-client'

export const TASK_PROVIDERS: readonly TaskProvider[] = ['todoist', 'things'] as const

export const PROVIDER_LABEL: Record<TaskProvider, string> = {
  todoist: 'Todoist',
  things: 'Things',
}

/** Brand colours, used for the dot next to a group heading. */
export const PROVIDER_COLOR: Record<TaskProvider, string> = {
  todoist: '#E44332',
  things: '#1A79E5',
}

export type ProviderState = 'checking' | 'connected' | 'not_configured' | 'auth_required' | 'error'

export interface ProviderStatus {
  provider: TaskProvider
  state: ProviderState
  message: string
}

export type TaskFilter = 'today' | 'upcoming' | 'all'

function base(provider: TaskProvider): string {
  return `/api/${provider}`
}

async function checkOne(provider: TaskProvider): Promise<ProviderStatus> {
  const label = PROVIDER_LABEL[provider]
  try {
    const res = await fetch(`${base(provider)}/status`)
    if (isAuthResponse(res)) {
      return { provider, state: 'auth_required', message: `Auth required. Sign in again to use ${label}.` }
    }
    if (!res.ok) {
      return { provider, state: 'error', message: await readApiError(res, `${label} status check failed`) }
    }
    const data = await res.json()
    if (!data.configured) {
      return {
        provider,
        state: 'not_configured',
        message: provider === 'todoist'
          ? 'Set TODOIST_API_TOKEN on the server to pull tasks.'
          : 'Connect Things 3 in Settings to pull tasks.',
      }
    }
    // Things reports reachability separately: configured but the sidecar is down.
    if (data.reachable === false) {
      return { provider, state: 'error', message: `${label} service is not reachable.` }
    }
    return { provider, state: 'connected', message: `${label} synced` }
  } catch (err) {
    return { provider, state: 'error', message: err instanceof Error ? err.message : `${label} unavailable` }
  }
}

export async function loadProviderStatuses(): Promise<ProviderStatus[]> {
  return Promise.all(TASK_PROVIDERS.map(checkOne))
}

export interface LoadedTasks {
  tasks: ExternalTask[]
  /** Provider-keyed failures, so the UI can show a partial list plus a warning. */
  errors: { provider: TaskProvider; message: string }[]
}

async function fetchOne(provider: TaskProvider, filter: TaskFilter): Promise<ExternalTask[]> {
  const res = await fetch(`${base(provider)}/tasks?filter=${filter}`)
  if (!res.ok) throw new Error(await readApiError(res, `Failed to load ${PROVIDER_LABEL[provider]} tasks`))
  const data = await res.json()
  return ((data.tasks ?? []) as ExternalTask[]).map(task => ({ ...task, provider }))
}

type FetchOutcome =
  | { ok: true; provider: TaskProvider; tasks: ExternalTask[] }
  | { ok: false; provider: TaskProvider; message: string }

export async function loadTasks(filter: TaskFilter, providers: TaskProvider[]): Promise<LoadedTasks> {
  const settled = await Promise.all(
    providers.map(async (provider): Promise<FetchOutcome> => {
      try {
        return { ok: true, provider, tasks: await fetchOne(provider, filter) }
      } catch (err) {
        return { ok: false, provider, message: err instanceof Error ? err.message : 'Failed to load tasks' }
      }
    }),
  )

  const tasks: ExternalTask[] = []
  const errors: { provider: TaskProvider; message: string }[] = []
  for (const result of settled) {
    if (result.ok) tasks.push(...result.tasks)
    else errors.push({ provider: result.provider, message: result.message })
  }
  return { tasks, errors }
}

/** Task ids are only unique within a provider, so key on both. */
export function taskKey(task: ExternalTask): string {
  return `${resolveProvider(task)}:${task.id}`
}

export async function completeTask(task: ExternalTask): Promise<void> {
  const provider = resolveProvider(task)
  const res = await fetch(`${base(provider)}/tasks/${task.id}/close`, { method: 'POST' })
  if (!res.ok) throw new Error(await readApiError(res, `Failed to close ${PROVIDER_LABEL[provider]} task`))
}

/**
 * Record focused minutes against a task. Todoist gets a real duration; Things
 * gets a note. Best-effort — the caller has already saved the session.
 */
export async function recordFocusTime(
  provider: TaskProvider,
  taskId: string,
  minutes: number,
): Promise<void> {
  const res = await fetch(`${base(provider)}/tasks/${taskId}/duration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ add_minutes: Math.max(1, Math.round(minutes)) }),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'Failed to record focus time'))
}
