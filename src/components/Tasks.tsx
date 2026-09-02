'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { CategoryRecord, ExternalTask, TaskProvider } from '@/types'
import { resolveProvider } from '@/types'
import {
  ALL_SCOPE,
  DEFAULT_ALL_OPTIONS,
  SORT_LABEL,
  applyAllOptions,
  buildSidebar,
  sectionize,
  type AllOptions,
  type ScopeId,
  type ScopeRow,
  type SortKey,
} from '@/lib/task-views'
import { useCategories } from '@/context/CategoriesContext'
import { useSettings } from '@/context/SettingsContext'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { redirectToLogin } from '@/lib/api-client'
import { encodeTaskRef } from '@/lib/task-ref'
import { capGroups, type CappedGroup } from '@/lib/modernist'
import {
  PROVIDER_COLOR,
  PROVIDER_LABEL,
  canCreateTasks,
  completeTask as completeProviderTask,
  enabledProviders,
  loadProviderStatuses,
  loadTasks,
  taskKey,
  type ProviderStatus,
} from '@/lib/task-sources'
import TaskList, { type TaskRowModel } from './md/TaskList'
import TaskComposer from './md/TaskComposer'
import ResizeHandle from './md/ResizeHandle'
import { usePaneWidth } from '@/hooks/usePaneWidth'
import { MdIcon } from './md/icons'
import { useShellStatus } from './md/shell-status'

export interface PendingFocus {
  intention: string
  category?: string
  /**
   * Provider-qualified references, so the session completes the right tasks.
   * A session can be pointed at several at once — one sitting often clears a
   * handful of small things rather than one big one.
   */
  taskIds: string[]
}

type Filter = 'today' | 'upcoming' | 'all'

const SORT_ORDER: SortKey[] = ['date', 'priority', 'project']

/** The designed sidebar width, and how far it may be dragged from it. */
const SIDEBAR_BOUNDS = { min: 150, max: 340, fallback: 196 }

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

/** Group by provider *and* project — both apps can have a project of the same name. */
function groupByProject(tasks: ExternalTask[]) {
  const groups = new Map<string, { key: string; title: string; provider: TaskProvider; items: ExternalTask[] }>()
  for (const task of tasks) {
    const provider = resolveProvider(task)
    const title = task.projectName || PROVIDER_LABEL[provider]
    const key = `${provider}:${title}`
    const existing = groups.get(key)
    if (existing) existing.items.push(task)
    else groups.set(key, { key, title, provider, items: [task] })
  }
  return Array.from(groups.values())
}

function baseFilter(tasks: ExternalTask[], filter: Filter): ExternalTask[] {
  const active = tasks.filter(task => !task.completed)
  if (filter === 'today') return active.filter(task => task.due === 'today')
  if (filter === 'upcoming') {
    // Upcoming answers "what lands, and when" — so it is only the dated work.
    // Anything undated is a someday pile, not a schedule; sweeping it in here
    // buried the handful of real dates under hundreds of them.
    return active.filter(task => task.due === 'tomorrow' || task.due === 'upcoming')
  }
  return active
}

function estimateLabel(task: ExternalTask): string {
  const amount = task.duration?.amount
  return typeof amount === 'number' && amount > 0 ? `${amount}m` : ''
}

export default function Tasks({ onFocusTask }: { onFocusTask: (payload: PendingFocus) => void }) {
  const { categories } = useCategories()
  const { settings, loaded: settingsLoaded } = useSettings()
  const { reportSub, reportOpenTasks } = useShellStatus()
  const isDesktop = useIsDesktop()
  const phone = !isDesktop
  // Only this one setting changes which providers are asked; depending on the
  // whole object would re-fetch every task on an unrelated preference change.
  const providers = useMemo(() => enabledProviders(settings), [settings.todoistEnabled]) // eslint-disable-line react-hooks/exhaustive-deps
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [tasks, setTasks] = useState<ExternalTask[]>([])
  const [filter, setFilter] = useState<Filter>('today')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [completingKey, setCompletingKey] = useState<string | null>(null)
  const [allOptions, setAllOptions] = useState<AllOptions>(DEFAULT_ALL_OPTIONS)
  /** Keyed by `taskKey`, so a refreshed list keeps the same tasks selected. */
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const sidebarPane = usePaneWidth('sidebar', SIDEBAR_BOUNDS)

  const load = useCallback(async () => {
    // Until the stored settings land, `providers` is only the default — asking
    // now would query, and name, a provider that has been switched off.
    if (!settingsLoaded) return
    setLoading(true)
    setError(null)
    try {
      const next = await loadProviderStatuses(providers)
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
  }, [providers, settingsLoaded])

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

  const openCount = useMemo(() => tasks.filter(t => !t.completed).length, [tasks])

  useEffect(() => {
    reportOpenTasks(openCount)
    reportSub('tasks', `${openCount} open across ${statuses.filter(s => s.state === 'connected').length || 'no'} source${openCount === 1 ? '' : 's'}`)
  }, [openCount, reportOpenTasks, reportSub, statuses])

  const counts = useMemo(() => ({
    today: baseFilter(tasks, 'today').length,
    upcoming: baseFilter(tasks, 'upcoming').length,
    all: baseFilter(tasks, 'all').length,
  }), [tasks])

  const sidebar = useMemo(() => buildSidebar(tasks), [tasks])

  /**
   * The scope chips pick which pile; the sidebar, the dated filter and the
   * sort then cut it down. `applyAllOptions` does the cutting for every pile,
   * with the sidebar scope neutralised unless we are actually in All.
   */
  const shown = useMemo(() => {
    const base = baseFilter(tasks, filter)
    return applyAllOptions(base, filter === 'all' ? allOptions : { ...allOptions, scope: ALL_SCOPE })
  }, [allOptions, filter, tasks])

  const sections = useMemo(
    () => (filter === 'all'
      ? sectionize(shown, allOptions.group)
      : groupByProject(shown)),
    [allOptions.group, filter, shown],
  )

  const connected = statuses.filter(s => s.state === 'connected')
  const authRequired = statuses.some(s => s.state === 'auth_required')
  const canCompose = connected.some(s => canCreateTasks(s.provider))

  // Resolved against the current list rather than stored as task objects, so a
  // refresh (or a filter change) can never hand the timer a stale copy. Kept in
  // the order they were picked — that is the order they will be worked through.
  const selectedTasks = useMemo(() => {
    const byKey = new Map(tasks.map(task => [taskKey(task), task]))
    return selectedKeys.map(key => byKey.get(key)).filter((task): task is ExternalTask => !!task)
  }, [selectedKeys, tasks])

  const toggleSelected = (task: ExternalTask) => {
    const key = taskKey(task)
    setSelectedKeys(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  /** Hand a set of tasks to the timer as one session. */
  const focusOn = (picked: ExternalTask[]) => {
    if (picked.length === 0) return
    onFocusTask({
      // The topic names every task in the session; the timer keeps it editable.
      intention: picked.map(task => task.content).join(' · '),
      // One category for the session — the first task's, since it leads.
      category: taskCategory(picked[0], categories)?.name,
      taskIds: picked.map(task => encodeTaskRef(resolveProvider(task), task.id)),
    })
    setSelectedKeys([])
  }

  const complete = async (task: ExternalTask) => {
    const key = taskKey(task)
    setCompletingKey(key)
    try {
      await completeProviderTask(task)
      // Let the row's leave animation play before it is actually removed.
      window.setTimeout(() => {
        setTasks(prev => prev.filter(t => taskKey(t) !== key))
        setSelectedKeys(prev => prev.filter(k => k !== key))
        setCompletingKey(null)
      }, 420)
    } catch (err) {
      setCompletingKey(null)
      setError(err instanceof Error ? err.message : 'Failed to close task')
    }
  }

  const rowFor = useCallback((task: ExternalTask): TaskRowModel => {
    const provider = resolveProvider(task)
    const key = taskKey(task)
    const selected = selectedKeys.includes(key)
    return {
      key,
      title: task.content,
      project: task.projectName ?? PROVIDER_LABEL[provider],
      due: task.dueLabel ?? '',
      est: estimateLabel(task),
      dot: PROVIDER_COLOR[provider],
      selected,
      completing: completingKey === key,
      ariaLabel: selected
        ? `Remove ${task.content} from the session`
        : `Add ${task.content} to the session`,
      onPick: () => toggleSelected(task),
      onFocus: () => focusOn([task]),
      onComplete: () => { void complete(task) },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, completingKey, selectedKeys, tasks])

  // Nothing scrolls: the pane renders what fits and counts the remainder.
  const groups: CappedGroup<TaskRowModel>[] = useMemo(() => capGroups(
    sections
      .filter(section => section.items.length > 0)
      .map(section => ({ label: section.title || 'All open', rows: section.items.map(rowFor) })),
    phone ? 9 : 15,
  ), [phone, rowFor, sections])

  // Nothing connected: explain each provider rather than assuming Todoist.
  if (connected.length === 0 && !loading) {
    return (
      <div className="md-screen md-screen-col" style={{ padding: phone ? '18px' : '24px 32px' }}>
        {phone && <h2 className="md-title" style={{ fontSize: 24, marginBottom: 18 }}>Tasks</h2>}
        <span className="md-eyebrow" style={{ marginBottom: 10 }}>
          {authRequired ? 'Task sync needs sign-in' : 'No task source connected'}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {statuses.map(status => (
            <div
              key={status.provider}
              className="md-hairline"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '12px 0',
                '--hairline-inset': '18px',
              } as CSSProperties}
            >
              <span style={{ width: 8, height: 8, marginTop: 6, flex: 'none', borderRadius: 4, background: PROVIDER_COLOR[status.provider] }} />
              <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{PROVIDER_LABEL[status.provider]}</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--color-text-2)' }}>{status.message}</span>
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            className="btn btn-primary btn-md"
            onClick={authRequired ? () => redirectToLogin() : load}
            style={{ gap: 10 }}
          >
            {authRequired ? 'Sign in' : 'Check connections'}
            <MdIcon name="arrow" size={17} strokeWidth={2} color="var(--accent-on)" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="md-screen">
      {!phone && filter === 'all' && (
        <>
        <nav
          aria-label="Task lists"
          style={{
            flex: 'none',
            width: sidebarPane.width,
            padding: '12px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            overflow: 'hidden',
          }}
        >
          <SidebarRow
            row={{ id: ALL_SCOPE, label: 'All', count: sidebar.total }}
            active={allOptions.scope === ALL_SCOPE}
            onSelect={scope => setAllOptions({ ...allOptions, scope })}
          />
          {[...sidebar.views, ...sidebar.areas, ...sidebar.projects].slice(0, 14).map(row => (
            <SidebarRow
              key={row.id}
              row={row}
              active={allOptions.scope === row.id}
              onSelect={scope => setAllOptions({ ...allOptions, scope })}
            />
          ))}
        </nav>
        <ResizeHandle
          label="Task list sidebar width"
          width={sidebarPane.width}
          min={SIDEBAR_BOUNDS.min}
          max={SIDEBAR_BOUNDS.max}
          dragging={sidebarPane.dragging}
          towards="start"
          onStart={sidebarPane.startDrag}
          onNudge={sidebarPane.nudge}
          onReset={sidebarPane.reset}
        />
        </>
      )}

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            padding: phone ? '14px 16px 10px' : '12px 16px 10px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 4,
            // The composer sits directly below and ends the block itself, so
            // the filters only close it off when there is no composer.
            borderBottom: canCompose ? 0 : '1px solid var(--line)',
            flex: 'none',
          }}
        >
          {phone && <h2 className="md-title" style={{ fontSize: 24, width: '100%', marginBottom: 8 }}>Tasks</h2>}

          {([['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="md-quiet"
              data-active={filter === value ? 'true' : 'false'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label} · {counts[value]}
            </button>
          ))}

          <button
            type="button"
            className="md-quiet"
            data-active={allOptions.hideUndated ? 'true' : 'false'}
            aria-pressed={allOptions.hideUndated}
            onClick={() => setAllOptions({ ...allOptions, hideUndated: !allOptions.hideUndated })}
          >
            Dated only
          </button>

          <button
            type="button"
            className="md-quiet"
            onClick={() => setAllOptions({
              ...allOptions,
              sort: SORT_ORDER[(SORT_ORDER.indexOf(allOptions.sort) + 1) % SORT_ORDER.length],
            })}
          >
            Sort · {SORT_LABEL[allOptions.sort]}
          </button>

          <button
            type="button"
            className="btn btn-icon md-press-sm"
            onClick={load}
            disabled={loading}
            aria-label="Refresh tasks"
            style={{ marginLeft: 'auto' }}
          >
            <MdIcon name="refresh" size={15} strokeWidth={2} className={loading ? 'md-spin' : undefined} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '6px 16px 8px', color: 'var(--warn)', fontSize: 12.5, fontWeight: 600, flex: 'none' }}>
            {error}
          </div>
        )}
        {syncing && !error && (
          <div className="md-meta" style={{ padding: '6px 16px 8px', flex: 'none' }}>
            Still catching up with Things — more tasks will appear shortly.
          </div>
        )}

        {canCompose && <TaskComposer scope={filter} onCreated={load} />}

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <TaskList groups={groups} emptyLabel="Nothing here. Enjoy the calm." />
        </div>

        {selectedTasks.length > 0 && (
          <div
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px 12px',
              borderTop: '1px solid var(--line)',
              background: 'var(--color-surface)',
            }}
          >
            <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14 }}>
                {selectedTasks.length} {selectedTasks.length === 1 ? 'task' : 'tasks'} selected
              </span>
              <span className="md-meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedTasks.map(task => task.content).join(' · ')}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setSelectedKeys([])}
              style={{ flex: 'none' }}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn btn-primary btn-md"
              onClick={() => focusOn(selectedTasks)}
              style={{ flex: 'none' }}
            >
              Focus
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SidebarRow({
  row,
  active,
  onSelect,
}: {
  row: ScopeRow
  active: boolean
  onSelect: (id: ScopeId) => void
}) {
  return (
    <button
      type="button"
      className="md-rail-item md-press"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(row.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '8px 12px',
        minHeight: 36,
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        color: active ? 'var(--color-text)' : 'var(--color-text-2)',
        fontFamily: 'var(--font-heading)',
        fontSize: 13.5,
        fontWeight: active ? 600 : 500,
        textAlign: 'left',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          flex: 'none',
          display: 'block',
          borderRadius: 4,
          background: row.provider ? PROVIDER_COLOR[row.provider] : 'var(--color-text-3)',
        }}
      />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.label}
      </span>
      <span className="md-num md-meta" style={{ letterSpacing: 0 }}>{row.count}</span>
    </button>
  )
}
