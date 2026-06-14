import { NextResponse } from 'next/server'
import { isTodoistConfigured, listActiveTasks, listProjects, listTodayTasks } from '@/lib/todoist'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'

export const dynamic = 'force-dynamic'

type TaskFilter = 'today' | 'upcoming' | 'all'

function todayKey() {
  return new Date().toLocaleDateString('en-CA')
}

function tomorrowKey() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}

function dueKind(date: string | undefined | null): 'today' | 'tomorrow' | 'upcoming' | null {
  if (!date) return null
  if (date <= todayKey()) return 'today'
  if (date === tomorrowKey()) return 'tomorrow'
  return 'upcoming'
}

function dueLabel(date: string | undefined | null, fallback: string | undefined): string | null {
  const kind = dueKind(date)
  if (kind === 'today') return 'Today'
  if (kind === 'tomorrow') return 'Tomorrow'
  return fallback ?? date ?? null
}

function normalizePriority(priority: number | undefined): number {
  const p = Number(priority) || 1
  return Math.max(1, Math.min(4, 5 - p))
}

export async function GET(request: Request) {
  const auth = validateTodoistAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  if (!isTodoistConfigured()) {
    return NextResponse.json({ error: 'Todoist not configured' }, { status: 503 })
  }

  try {
    const url = new URL(request.url)
    const requested = url.searchParams.get('filter')
    const filter: TaskFilter = requested === 'upcoming' || requested === 'all' ? requested : 'today'
    const [data, projects] = await Promise.all([
      filter === 'today' ? listTodayTasks() : listActiveTasks(),
      listProjects().catch(() => []),
    ])
    const projectNames = new Map(projects.map(project => [String(project.id), project.name]))
    const filtered = filter === 'upcoming'
      ? data.filter(task => dueKind(task.due?.date) !== 'today')
      : data

    return NextResponse.json({
      tasks: filtered.map(task => {
        const projectId = task.project_id ?? task.projectId ?? null
        return {
          id: String(task.id),
          content: task.content,
          duration: task.duration,
          labels: task.labels ?? [],
          priority: normalizePriority(task.priority),
          projectId: projectId ? String(projectId) : null,
          projectName: projectId ? projectNames.get(String(projectId)) ?? 'Todoist' : 'Todoist',
          due: dueKind(task.due?.date),
          dueLabel: dueLabel(task.due?.date, task.due?.string),
          category: (task.labels ?? [])[0] ?? null,
          completed: !!task.completed,
        }
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
