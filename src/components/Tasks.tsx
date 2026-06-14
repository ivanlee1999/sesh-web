'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CategoryRecord, TodoistTask } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { Btn, CatBadge, Chip, Icon, ScreenHead, tint } from './sesh-ui'

export interface PendingFocus {
  intention: string
  category?: string
  taskId: string
}

type Filter = 'today' | 'upcoming' | 'all'

const priorityColor: Record<number, string | null> = {
  1: '#D1453B',
  2: '#EB8909',
  3: '#246FE0',
  4: null,
}

function taskCategory(task: TodoistTask, categories: CategoryRecord[]): CategoryRecord | null {
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

function groupTasks(tasks: TodoistTask[]) {
  const groups = new Map<string, TodoistTask[]>()
  for (const task of tasks) {
    const project = task.projectName || 'Todoist'
    groups.set(project, [...(groups.get(project) ?? []), task])
  }
  return Array.from(groups.entries()).map(([project, items]) => ({ project, items }))
}

function filterTasks(tasks: TodoistTask[], filter: Filter) {
  const active = tasks.filter(task => !task.completed)
  if (filter === 'today') return active.filter(task => task.due === 'today')
  if (filter === 'upcoming') return active.filter(task => task.due !== 'today')
  return active
}

function TaskRow({
  task,
  category,
  onComplete,
  onFocus,
  completing,
}: {
  task: TodoistTask
  category: CategoryRecord | null
  onComplete: () => void
  onFocus: () => void
  completing: boolean
}) {
  const pri = priorityColor[task.priority] ?? null
  const color = category?.color ?? 'var(--line-strong)'

  return (
    <div className="flex items-center gap-3 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-[14px] py-3" style={{ opacity: completing ? 0.55 : 1 }}>
      <button
        type="button"
        aria-label="Complete task"
        onClick={onComplete}
        className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full bg-transparent p-0"
        style={{ border: `2px solid ${pri || color}` }}
      />
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
        className="grid h-[38px] w-[38px] flex-shrink-0 place-items-center rounded-full border-0"
        style={{ background: category ? tint(category.color, 16) : 'var(--accent-soft)' }}
      >
        <Icon name="play" size={17} color={category?.color ?? 'var(--accent-ink)'} />
      </button>
    </div>
  )
}

export default function Tasks({ onFocusTask }: { onFocusTask: (payload: PendingFocus) => void }) {
  const { categories } = useCategories()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [tasks, setTasks] = useState<TodoistTask[]>([])
  const [filter, setFilter] = useState<Filter>('today')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const status = await fetch('/api/todoist/status')
      if (!status.ok) {
        setConfigured(false)
        setTasks([])
        return
      }
      const statusData = await status.json()
      setConfigured(!!statusData.configured)
      if (!statusData.configured) {
        setTasks([])
        return
      }
      const res = await fetch('/api/todoist/tasks?filter=all')
      if (!res.ok) throw new Error('Failed to load Todoist tasks')
      const data = await res.json()
      setTasks(data.tasks ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Todoist tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => ({
    today: filterTasks(tasks, 'today').length,
    upcoming: filterTasks(tasks, 'upcoming').length,
    all: filterTasks(tasks, 'all').length,
  }), [tasks])

  const shown = useMemo(() => filterTasks(tasks, filter), [tasks, filter])
  const groups = useMemo(() => groupTasks(shown), [shown])

  const completeTask = async (taskId: string) => {
    setCompletingId(taskId)
    try {
      const res = await fetch(`/api/todoist/tasks/${taskId}/close`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to close task')
      setTasks(prev => prev.filter(task => task.id !== taskId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close task')
    } finally {
      setCompletingId(null)
    }
  }

  if (configured === false && !loading) {
    return (
      <div className="flex h-full flex-col px-[26px] pb-[calc(110px+var(--safe-b))] pt-[calc(58px+var(--safe-t))]">
        <ScreenHead title="Tasks" />
        <div className="flex flex-1 flex-col items-center justify-center gap-[22px] text-center">
          <div className="grid h-[72px] w-[72px] place-items-center rounded-[20px] bg-[#E44332] shadow-[0_10px_30px_rgba(228,67,50,0.3)]">
            <Icon name="list" size={34} color="#fff" stroke={2} />
          </div>
          <div>
            <h2 className="m-0 font-[var(--font-display)] text-[22px] font-bold tracking-[-0.03em]">Connect Todoist</h2>
            <p className="mx-auto mb-0 mt-[10px] max-w-[290px] text-[15.5px] leading-normal text-[var(--ink-2)]">
              Add a Todoist API token to pull your tasks in and focus on them one session at a time.
            </p>
          </div>
          <Btn size="lg" icon="link" style={{ background: '#E44332', color: '#fff' }} onClick={load}>Check connection</Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto pb-[calc(110px+var(--safe-b))]">
      <ScreenHead
        title="Tasks"
        right={
          <button type="button" onClick={load} className="mt-[10px] flex items-center gap-[7px] border-0 bg-transparent p-0">
            <span className="h-2 w-2 rounded-full bg-[#3F9142]" />
            <span className="text-[12.5px] font-medium text-[var(--ink-3)]">{loading ? 'Syncing' : 'Todoist synced'}</span>
          </button>
        }
      />

      <div className="flex gap-2 px-[22px] pb-2 pt-[14px]">
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

      {error && <div className="mx-[22px] my-3 rounded-[var(--r-md)] border border-[#C2615A]/20 bg-[#C2615A]/10 px-4 py-3 text-[13px] text-[#C2615A]">{error}</div>}

      <div className="px-[22px] py-2">
        {loading && tasks.length === 0 ? (
          <div className="py-[50px] text-center text-[14px] text-[var(--ink-3)]">Loading tasks...</div>
        ) : groups.length > 0 ? (
          groups.map(group => (
            <div key={group.project} className="mb-6">
              <div className="mb-[11px] flex items-center gap-2 text-[13px] font-bold tracking-[-0.01em] text-[var(--ink-2)]">
                <Icon name="inbox" size={15} color="var(--ink-3)" />
                {group.project}
              </div>
              <div className="flex flex-col gap-[9px]">
                {group.items.map(task => {
                  const category = taskCategory(task, categories)
                  return (
                    <TaskRow
                      key={task.id}
                      task={task}
                      category={category}
                      completing={completingId === task.id}
                      onComplete={() => completeTask(task.id)}
                      onFocus={() => onFocusTask({ intention: task.content, category: category?.name, taskId: task.id })}
                    />
                  )
                })}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-5 py-[34px] text-center text-[var(--ink-3)]">
            <Icon name="check" size={30} color="var(--ink-3)" />
            <div className="mt-3 text-[15px]">Nothing here. Enjoy the calm.</div>
          </div>
        )}
      </div>
    </div>
  )
}
