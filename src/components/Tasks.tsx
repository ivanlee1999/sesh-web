'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CategoryRecord, ExternalTask, TaskProvider } from '@/types'
import { resolveProvider } from '@/types'
import TaskSidebar from './TaskSidebar'
import TaskListOptions from './TaskListOptions'
import {
  ALL_SCOPE,
  DEFAULT_ALL_OPTIONS,
  applyAllOptions,
  availableTags,
  buildSidebar,
  sectionize,
  type AllOptions,
} from '@/lib/task-views'
import { useCategories } from '@/context/CategoriesContext'
import { redirectToLogin } from '@/lib/api-client'
import { encodeTaskRef } from '@/lib/task-ref'
import {
  PROVIDER_COLOR,
  PROVIDER_LABEL,
  completeTask as completeProviderTask,
  loadProviderStatuses,
  loadTasks,
  taskKey,
  type ProviderStatus,
} from '@/lib/task-sources'
import { Btn, CatBadge, Chip, Icon, ScreenHead, tint } from './sesh-ui'

export interface PendingFocus {
  intention: string
  category?: string
  /** Provider-qualified reference, so the session completes the right task. */
  taskId: string
}

type Filter = 'today' | 'upcoming' | 'all'

const priorityColor: Record<number, string | null> = {
  1: '#D1453B',
  2: '#EB8909',
  3: '#246FE0',
  4: null,
}

function taskCategory(task: ExternalTask, categories: CategoryRecord[]): CategoryRecord | null {
  const raw = task.category?.toLowerCase()
  if (raw) {
    const found = categories.find(c => c.name.toLowerCase() === raw || c.label.toLowerCase() === raw)
    if (found) return found
  }
  for (const label of task.labels ?? []) {
    const lower = label.toLowerCase()
    const found = categories.find(c => c.name.toLowerCase() === lower || c.label.toLowerCase() === lower)
    if (found) return found
  }
  return categories[0] ?? null
}

interface TaskGroup {
  key: string
  project: string
  provider: TaskProvider
  items: ExternalTask[]
}

/** Group by provider *and* project — both apps can have a project of the same name. */
function groupTasks(tasks: ExternalTask[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>()
  for (const task of tasks) {
    const provider = resolveProvider(task)
    const project = task.projectName || PROVIDER_LABEL[provider]
    const key = `${provider}:${project}`
    const existing = groups.get(key)
    if (existing) existing.items.push(task)
    else groups.set(key, { key, project, provider, items: [task] })
  }
  return Array.from(groups.values())
}

function filterTasks(tasks: ExternalTask[], filter: Filter) {
  const active = tasks.filter(task => !task.completed)
  if (filter === 'today') return active.filter(task => task.due === 'today')
  if (filter === 'upcoming') {
    // Upcoming answers "what lands, and when" — so it is only the dated work.
    // Anything undated is a someday pile, not a schedule; sweeping it in here
    // buried the handful of real dates under hundreds of them.
    return active
      .filter(task => task.due === 'tomorrow' || task.due === 'upcoming')
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
  }
  return active
}

function TaskRow({
  task,
  category,
  onComplete,
  onFocus,
  completing,
}: {
  task: ExternalTask
  category: CategoryRecord | null
  onComplete: () => void
  onFocus: () => void
  completing: boolean
}) {
  const pri = priorityColor[task.priority] ?? null
  const color = category?.color ?? 'var(--line-strong)'

  return (
    <div
      className={`flex items-center gap-3 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-[14px] py-3 ${completing ? 'anim-row-leave' : ''}`}
      style={{ transition: 'opacity var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out)' }}
    >
      <button
        type="button"
        aria-label="Complete task"
        onClick={onComplete}
        className="press-sm grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full p-0"
        style={{
          border: `2px solid ${pri || color}`,
          background: completing ? (pri || color) : 'transparent',
          transition: 'background var(--dur-2) var(--ease-out)',
        }}
      >
        {completing && <Icon name="check" size={12} color="#fff" stroke={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold tracking-[-0.01em]">{task.content}</div>
        <div className="mt-1 flex items-center gap-[9px]">
          <CatBadge category={category} size="sm" />
          {task.dueLabel && (
            <span className="text-[12px] font-medium" style={{ color: task.due === 'today' ? 'var(--accent-ink)' : 'var(--ink-3)' }}>
              {task.dueLabel}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="Focus on task"
        onClick={onFocus}
        className="press grid h-[38px] w-[38px] flex-shrink-0 place-items-center rounded-full border-0"
        style={{ background: category ? tint(category.color, 16) : 'var(--accent-soft)' }}
      >
        <Icon name="play" size={17} color={category?.color ?? 'var(--accent-ink)'} />
      </button>
    </div>
  )
}

export default function Tasks({ onFocusTask }: { onFocusTask: (payload: PendingFocus) => void }) {
  const { categories } = useCategories()
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [tasks, setTasks] = useState<ExternalTask[]>([])
  const [filter, setFilter] = useState<Filter>('today')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [completingKey, setCompletingKey] = useState<string | null>(null)
  const [allOptions, setAllOptions] = useState<AllOptions>(DEFAULT_ALL_OPTIONS)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await loadProviderStatuses()
      setStatuses(next)

      const connected = next.filter(s => s.state === 'connected').map(s => s.provider)
      if (connected.length === 0) {
        setTasks([])
        return
      }

      // A provider that fails here is reported inline; the others still render.
      const { tasks: loaded, errors, syncing: pending } = await loadTasks('all', connected)
      setTasks(loaded)
      setSyncing(pending)
      if (errors.length > 0) {
        setError(errors.map(e => `${PROVIDER_LABEL[e.provider]}: ${e.message}`).join(' · '))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /**
   * A newly connected Things account has years of history to replay, and the
   * request that starts it answers with whatever is ready rather than holding
   * the page open until the rest arrives. Check back until it has.
   */
  useEffect(() => {
    if (!syncing) return
    const timer = setTimeout(() => { load() }, 5000)
    return () => clearTimeout(timer)
  }, [syncing, load])

  const counts = useMemo(() => ({
    today: filterTasks(tasks, 'today').length,
    upcoming: filterTasks(tasks, 'upcoming').length,
    all: filterTasks(tasks, 'all').length,
  }), [tasks])

  const sidebar = useMemo(() => buildSidebar(tasks), [tasks])
  const tags = useMemo(() => availableTags(tasks), [tasks])

  // All is the only filter with controls; Today and Upcoming each answer a
  // single question and stay grouped by project.
  const shown = useMemo(
    () => (filter === 'all' ? applyAllOptions(tasks, allOptions) : filterTasks(tasks, filter)),
    [tasks, filter, allOptions],
  )
  const sections = useMemo(
    () => (filter === 'all'
      ? sectionize(shown, allOptions.group)
      : groupTasks(shown).map(g => ({ key: g.key, title: g.project, provider: g.provider, items: g.items }))),
    [filter, shown, allOptions.group],
  )

  const scopeLabel = useMemo(() => {
    if (allOptions.scope === ALL_SCOPE) return 'All'
    const rows = [...sidebar.views, ...sidebar.areas, ...sidebar.projects]
    return rows.find(row => row.id === allOptions.scope)?.label ?? 'All'
  }, [allOptions.scope, sidebar])

  const connected = statuses.filter(s => s.state === 'connected')
  const authRequired = statuses.some(s => s.state === 'auth_required')

  const complete = async (task: ExternalTask) => {
    const key = taskKey(task)
    setCompletingKey(key)
    try {
      await completeProviderTask(task)
      setTasks(prev => prev.filter(t => taskKey(t) !== key))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close task')
    } finally {
      setCompletingKey(null)
    }
  }

  // Nothing connected: explain each provider rather than assuming Todoist.
  if (connected.length === 0 && !loading) {
    return (
      <div className="flex h-full w-full min-w-0 flex-col px-[var(--gutter)] pb-[var(--screen-bottom-space)] pt-[calc(var(--screen-top)+34px+var(--safe-t))]">
        <ScreenHead title="Tasks" />
        <div className="flex flex-1 flex-col items-center justify-center gap-[22px] text-center">
          <div className="anim-pop grid h-[72px] w-[72px] place-items-center rounded-[20px] bg-[var(--surface-2)]">
            <Icon name="list" size={34} color="var(--ink-3)" stroke={2} />
          </div>
          <div>
            <h2 className="m-0 font-[var(--font-display)] text-[22px] font-bold tracking-[-0.03em]">
              {authRequired ? 'Task sync needs sign-in' : 'No task source connected'}
            </h2>
            <div className="mx-auto mt-[14px] flex max-w-[320px] flex-col gap-2">
              {statuses.map(status => (
                <div
                  key={status.provider}
                  className="flex items-start gap-[9px] rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-[14px] py-[11px] text-left"
                >
                  <span
                    className="mt-[6px] h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: PROVIDER_COLOR[status.provider] }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{PROVIDER_LABEL[status.provider]}</span>
                    <span className="block text-[12.5px] leading-snug text-[var(--ink-3)]">{status.message}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Btn
            size="lg"
            icon={authRequired ? 'logout' : 'sync'}
            onClick={authRequired ? () => redirectToLogin() : load}
          >
            {authRequired ? 'Sign in' : 'Check connections'}
          </Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full min-w-0 overflow-y-auto pb-[var(--screen-bottom-space)]">
      <ScreenHead
        title="Tasks"
        right={
          <button type="button" onClick={load} className="press mt-[10px] flex items-center gap-[7px] border-0 bg-transparent p-0">
            <span className="flex items-center gap-[3px]">
              {connected.map(status => (
                <span
                  key={status.provider}
                  aria-label={PROVIDER_LABEL[status.provider]}
                  className="h-2 w-2 rounded-full"
                  style={{ background: PROVIDER_COLOR[status.provider] }}
                />
              ))}
            </span>
            <span className="text-[12.5px] font-medium text-[var(--ink-3)]">
              {loading ? 'Syncing' : connected.map(s => PROVIDER_LABEL[s.provider]).join(' + ')}
            </span>
          </button>
        }
      />

      <div className="flex gap-2 px-[var(--gutter)] pb-2 pt-[14px]">
        {([
          ['today', 'Today', counts.today],
          ['upcoming', 'Upcoming', counts.upcoming],
          ['all', 'All', counts.all],
        ] as const).map(([value, label, count]) => (
          <Chip key={value} active={filter === value} onClick={() => setFilter(value)}>
            {label} · {count}
          </Chip>
        ))}
      </div>

      {error && <div className="anim-fade-up mx-[var(--gutter)] my-3 rounded-[var(--r-md)] border border-[var(--warn)]/20 bg-[var(--warn)]/10 px-4 py-3 text-[13px] text-[var(--warn)]">{error}</div>}

      {syncing && !error && (
        <div className="anim-fade-up mx-[var(--gutter)] my-3 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[13px] text-[var(--ink-3)]">
          Still catching up with Things — more tasks will appear shortly.
        </div>
      )}

      {filter === 'all' && (
        <div className="flex items-center gap-[9px] px-[var(--gutter)] pb-1 pt-1">
          {/* Below 900px the sidebar lives in a drawer, so it needs a way in. */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="press flex flex-shrink-0 items-center gap-[6px] rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--surface)] px-[10px] py-[5px] text-[12.5px] font-medium text-[var(--ink-2)] min-[900px]:hidden"
          >
            <Icon name="list" size={14} color="var(--ink-2)" />
            {scopeLabel}
          </button>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <TaskListOptions options={allOptions} tags={tags} onChange={setAllOptions} />
          </div>
        </div>
      )}

      <div className={`px-[var(--gutter)] py-2 ${filter === 'all' ? 'task-pane' : ''}`}>
        {filter === 'all' && (
          <div className="hidden min-[900px]:block">
            <TaskSidebar
              sidebar={sidebar}
              scope={allOptions.scope}
              onSelect={scope => setAllOptions({ ...allOptions, scope })}
            />
          </div>
        )}
        <div>
        {loading && tasks.length === 0 ? (
          <div className="flex flex-col gap-[9px]" aria-label="Loading tasks">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[66px] rounded-[var(--r-md)]" />)}
          </div>
        ) : sections.length > 0 ? (
          <div key={filter} className="anim-fade">
            {sections.map(group => (
              <div key={group.key} className="mb-6">
                {group.title && (
                <div className="mb-[11px] flex items-center gap-2 text-[13px] font-bold tracking-[-0.01em] text-[var(--ink-2)]">
                  {group.provider && (
                    <span className="h-2 w-2 rounded-full" style={{ background: PROVIDER_COLOR[group.provider] }} />
                  )}
                  {group.title}
                  {/* Only name the source when both are connected, to avoid noise. */}
                  {group.provider && connected.length > 1 && (
                    <span className="text-[11.5px] font-medium text-[var(--ink-3)]">{PROVIDER_LABEL[group.provider]}</span>
                  )}
                </div>
                )}
                <div className="stagger flex flex-col gap-[9px]">
                  {group.items.map(task => {
                    const category = taskCategory(task, categories)
                    return (
                      <TaskRow
                        key={taskKey(task)}
                        task={task}
                        category={category}
                        completing={completingKey === taskKey(task)}
                        onComplete={() => complete(task)}
                        onFocus={() => onFocusTask({
                          intention: task.content,
                          category: category?.name,
                          taskId: encodeTaskRef(resolveProvider(task), task.id),
                        })}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="anim-fade-up rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-5 py-[34px] text-center text-[var(--ink-3)]">
            <Icon name="check" size={30} color="var(--ink-3)" />
            <div className="mt-3 text-[15px]">Nothing here. Enjoy the calm.</div>
          </div>
        )}
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 min-[900px]:hidden" role="dialog" aria-modal="true" aria-label="Task lists">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 border-0 bg-black/35 p-0"
          />
          <div className="anim-slide-in absolute inset-y-0 left-0 w-[78%] max-w-[300px] overflow-y-auto bg-[var(--surface)] px-[10px] pb-[var(--screen-bottom-space)] pt-[calc(var(--screen-top)+var(--safe-t))] shadow-xl">
            <TaskSidebar
              sidebar={sidebar}
              scope={allOptions.scope}
              onSelect={scope => {
                setAllOptions({ ...allOptions, scope })
                setDrawerOpen(false)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
