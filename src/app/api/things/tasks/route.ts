import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { dueKind, dueLabel } from '@/lib/task-dates'
import { listThingsTasks, type ThingsTaskRaw, type ThingsView } from '@/lib/things'
import { readThingsConfig } from '@/lib/things-config'

export const dynamic = 'force-dynamic'

type TaskFilter = 'today' | 'upcoming' | 'all'

const VIEWS_BY_FILTER: Record<TaskFilter, ThingsView[]> = {
  today: ['today'],
  upcoming: ['upcoming', 'anytime', 'inbox'],
  all: ['today', 'upcoming', 'anytime', 'inbox'],
}

function scheduledDate(task: ThingsTaskRaw): string | null {
  return task.start_date ?? task.startDate ?? task.scheduled ?? task.deadline ?? task.due_date ?? null
}

function groupName(task: ThingsTaskRaw): string {
  return task.project_title ?? task.projectTitle ?? task.area_title ?? task.areaTitle ?? 'Things'
}

function isDone(task: ThingsTaskRaw): boolean {
  return Boolean(task.completed) || task.status === 'completed'
}

export async function GET(request: Request) {
  const auth = validateTodoistAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const conn = readThingsConfig()
  if (!conn) {
    return NextResponse.json({ error: 'Things not configured' }, { status: 503 })
  }

  try {
    const requested = new URL(request.url).searchParams.get('filter')
    const filter: TaskFilter = requested === 'upcoming' || requested === 'all' ? requested : 'today'
    const raw = await listThingsTasks(conn, VIEWS_BY_FILTER[filter])

    const tasks = raw
      .filter(task => !isDone(task))
      .map(task => {
        const date = scheduledDate(task)
        const tags = task.tags ?? []
        return {
          id: String(task.uuid ?? task.id ?? ''),
          provider: 'things' as const,
          content: task.title ?? task.name ?? '(untitled)',
          // Things has no duration concept; sesh writes focused time to the note.
          duration: null,
          labels: tags,
          // No priority in Things — 4 is "none" on the shared 1..4 scale.
          priority: 4,
          projectId: null,
          projectName: groupName(task),
          due: dueKind(date),
          dueLabel: dueLabel(date),
          category: tags[0] ?? null,
          completed: false,
        }
      })
      .filter(task => task.id)

    const filtered = filter === 'upcoming' ? tasks.filter(task => task.due !== 'today') : tasks
    return NextResponse.json({ tasks: filtered })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
