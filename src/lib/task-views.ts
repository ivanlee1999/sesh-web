'use client'

/**
 * How the All screen slices the task list.
 *
 * Today and Upcoming each answer one question, so they need no controls. All
 * is the opposite: it holds everything, which is only useful if you can cut it
 * down. The sidebar picks *which* tasks, the options decide how they are
 * ordered and grouped, and both are kept here — pure functions over a list, so
 * the screen stays a rendering concern.
 */

import type { ExternalTask, TaskProvider } from '@/types'
import { resolveProvider } from '@/types'
import { PROVIDER_LABEL } from '@/lib/task-sources'

/** Things' own piles, in the order Things lists them. */
export const BUCKETS = ['inbox', 'anytime', 'someday'] as const
export type Bucket = (typeof BUCKETS)[number]

export const BUCKET_LABEL: Record<Bucket, string> = {
  inbox: 'Inbox',
  anytime: 'Anytime',
  someday: 'Someday',
}

export type SortKey = 'date' | 'priority' | 'project'
export type GroupKey = 'project' | 'date' | 'none'

export const SORT_LABEL: Record<SortKey, string> = {
  date: 'Date',
  priority: 'Priority',
  project: 'Project',
}

export const GROUP_LABEL: Record<GroupKey, string> = {
  project: 'Project',
  date: 'Date',
  none: 'None',
}

/**
 * Which sidebar row is selected, as one string so it can live in a single
 * piece of state and be compared by equality. `all` is everything; the rest
 * name a pile, an area or a project.
 */
export type ScopeId = string

export const ALL_SCOPE: ScopeId = 'all'

export function bucketScope(bucket: Bucket): ScopeId {
  return `bucket:${bucket}`
}
export function areaScope(name: string): ScopeId {
  return `area:${name}`
}
export function projectScope(provider: TaskProvider, name: string): ScopeId {
  return `project:${provider}:${name}`
}

export interface ScopeRow {
  id: ScopeId
  label: string
  count: number
  /** Drawn as the dot beside a project row, so the source stays visible. */
  provider?: TaskProvider
}

export interface Sidebar {
  views: ScopeRow[]
  areas: ScopeRow[]
  projects: ScopeRow[]
  total: number
}

function projectLabel(task: ExternalTask): string {
  return task.projectName || PROVIDER_LABEL[resolveProvider(task)]
}

/**
 * The sidebar is derived from the tasks themselves rather than fetched: an
 * area with nothing left in it is not worth a row, and a count that disagrees
 * with the list it opens is worse than no count at all.
 */
export function buildSidebar(tasks: ExternalTask[]): Sidebar {
  const open = tasks.filter(task => !task.completed)

  const views: ScopeRow[] = BUCKETS.map(bucket => ({
    id: bucketScope(bucket),
    label: BUCKET_LABEL[bucket],
    count: open.filter(task => task.bucket === bucket).length,
  })).filter(row => row.count > 0)

  const areaCounts = new Map<string, number>()
  const projectCounts = new Map<string, { label: string; provider: TaskProvider; count: number }>()

  for (const task of open) {
    if (task.areaName) areaCounts.set(task.areaName, (areaCounts.get(task.areaName) ?? 0) + 1)

    const provider = resolveProvider(task)
    const label = projectLabel(task)
    const id = projectScope(provider, label)
    const entry = projectCounts.get(id)
    if (entry) entry.count += 1
    else projectCounts.set(id, { label, provider, count: 1 })
  }

  const byCountThenName = (a: ScopeRow, b: ScopeRow) =>
    b.count - a.count || a.label.localeCompare(b.label)

  return {
    views,
    areas: Array.from(areaCounts)
      .map(([label, count]) => ({ id: areaScope(label), label, count }))
      .sort(byCountThenName),
    projects: Array.from(projectCounts)
      .map(([id, v]) => ({ id, label: v.label, count: v.count, provider: v.provider }))
      .sort(byCountThenName),
    total: open.length,
  }
}

function inScope(task: ExternalTask, scope: ScopeId): boolean {
  if (scope === ALL_SCOPE) return true
  if (scope.startsWith('bucket:')) return task.bucket === scope.slice('bucket:'.length)
  if (scope.startsWith('area:')) return task.areaName === scope.slice('area:'.length)
  if (scope.startsWith('project:')) return projectScope(resolveProvider(task), projectLabel(task)) === scope
  return true
}

export interface AllOptions {
  scope: ScopeId
  sort: SortKey
  group: GroupKey
  hideUndated: boolean
  /** A Things tag or sesh category; matched against both. */
  tag: string | null
}

export const DEFAULT_ALL_OPTIONS: AllOptions = {
  scope: ALL_SCOPE,
  sort: 'date',
  group: 'project',
  hideUndated: false,
  tag: null,
}

function matchesTag(task: ExternalTask, tag: string): boolean {
  const wanted = tag.toLowerCase()
  if (task.category?.toLowerCase() === wanted) return true
  return (task.labels ?? []).some(label => label.toLowerCase() === wanted)
}

/** Every tag and category present, so the filter only offers real choices. */
export function availableTags(tasks: ExternalTask[]): string[] {
  const seen = new Map<string, string>()
  for (const task of tasks) {
    if (task.completed) continue
    for (const label of task.labels ?? []) {
      if (label) seen.set(label.toLowerCase(), label)
    }
    if (task.category) seen.set(task.category.toLowerCase(), task.category)
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
}

/**
 * Undated work sorts last whatever the key, because a list that opens with
 * three hundred date-less items has buried the part you came to see.
 */
function compare(a: ExternalTask, b: ExternalTask, sort: SortKey): number {
  if (sort === 'priority') {
    const byPriority = (a.priority ?? 4) - (b.priority ?? 4)
    if (byPriority !== 0) return byPriority
  }
  if (sort === 'project') {
    const byProject = projectLabel(a).localeCompare(projectLabel(b))
    if (byProject !== 0) return byProject
  }
  const aDate = a.dueDate ?? ''
  const bDate = b.dueDate ?? ''
  if (aDate && bDate) return aDate.localeCompare(bDate)
  if (aDate) return -1
  if (bDate) return 1
  return a.content.localeCompare(b.content)
}

export function applyAllOptions(tasks: ExternalTask[], options: AllOptions): ExternalTask[] {
  return tasks
    .filter(task => !task.completed)
    .filter(task => inScope(task, options.scope))
    .filter(task => !options.hideUndated || Boolean(task.dueDate))
    .filter(task => !options.tag || matchesTag(task, options.tag))
    .sort((a, b) => compare(a, b, options.sort))
}

export interface TaskSection {
  key: string
  title: string
  provider?: TaskProvider
  items: ExternalTask[]
}

/**
 * Sections in the order the sorted list already established — grouping should
 * never silently re-order what the sort key just decided.
 */
export function sectionize(tasks: ExternalTask[], group: GroupKey): TaskSection[] {
  if (group === 'none') {
    return tasks.length ? [{ key: 'all', title: '', items: tasks }] : []
  }

  const sections = new Map<string, TaskSection>()
  for (const task of tasks) {
    const provider = resolveProvider(task)
    const key = group === 'date'
      ? task.dueLabel ?? 'No date'
      : `${provider}:${projectLabel(task)}`
    const existing = sections.get(key)
    if (existing) {
      existing.items.push(task)
      continue
    }
    sections.set(key, {
      key,
      title: group === 'date' ? (task.dueLabel ?? 'No date') : projectLabel(task),
      provider: group === 'date' ? undefined : provider,
      items: [task],
    })
  }
  return Array.from(sections.values())
}
