import { NextResponse } from 'next/server'
import { isTodoistConfigured, listActiveTasks, listProjects, listTodayTasks } from '@/lib/todoist'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { dueKind, dueLabel } from '@/lib/task-dates'

export const dynamic = 'force-dynamic'

type TaskFilter = 'today' | 'upcoming' | 'all'

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
          provider: 'todoist' as const,
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
