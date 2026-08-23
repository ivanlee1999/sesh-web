/**
 * Encoding for the external-task reference stored in `todoist_task_id`.
 *
 * That column predates multi-provider support and is used by both
 * `timer_state` and `sessions`. Rather than migrate the schema, non-Todoist
 * providers namespace their id (`things:UUID`); a bare id is Todoist, so every
 * existing row keeps working untouched.
 */

import type { TaskProvider } from '@/types'

const KNOWN: readonly TaskProvider[] = ['todoist', 'things'] as const

export interface TaskRef {
  provider: TaskProvider
  id: string
}

export function encodeTaskRef(provider: TaskProvider, id: string): string {
  return provider === 'todoist' ? id : `${provider}:${id}`
}

export function decodeTaskRef(ref: string | null | undefined): TaskRef | null {
  if (!ref) return null
  const sep = ref.indexOf(':')
  if (sep > 0) {
    const prefix = ref.slice(0, sep)
    const found = KNOWN.find(p => p === prefix)
    // Only treat the prefix as a provider when we recognise it — a Todoist id
    // containing a colon must not be mistaken for a namespaced ref.
    if (found) return { provider: found, id: ref.slice(sep + 1) }
  }
  return { provider: 'todoist', id: ref }
}
