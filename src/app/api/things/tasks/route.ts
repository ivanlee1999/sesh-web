import { NextResponse } from 'next/server'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'
import { dayClock, dayStartUtcSeconds, dueKind, dueLabel, formatDayLabel, readTimeZone } from '@/lib/task-dates'
import { type ThingsTaskRaw } from '@/lib/things'
import { readThingsConfig } from '@/lib/things-config'
import { createThings, loadThingsTasks, thingsCatchingUp } from '@/lib/things-service'

export const dynamic = 'force-dynamic'

type TaskFilter = 'today' | 'upcoming' | 'all'
type TaskBucket = 'today' | 'inbox' | 'anytime' | 'upcoming' | 'someday'

function scheduledDate(task: ThingsTaskRaw): string | null {
  return task.start_date ?? task.startDate ?? task.scheduled ?? task.deadline ?? task.due_date ?? null
}

function groupName(task: ThingsTaskRaw): string {
  return task.project_title ?? task.projectTitle ?? task.area_title ?? task.areaTitle ?? 'Things'
}

function areaName(task: ThingsTaskRaw): string | null {
  return task.area_title ?? task.areaTitle ?? null
}

/**
 * Which pile the sidebar files this under. The connection usually says; when
 * it does not, the date is enough to tell a scheduled to-do from a loose one.
 */
function bucketOf(task: ThingsTaskRaw, date: string | null, kind: string | null): TaskBucket {
  if (task.view) return task.view
  if (kind === 'today') return 'today'
  return date ? 'upcoming' : 'anytime'
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
    const params = new URL(request.url).searchParams
    const requested = params.get('filter')
    const filter: TaskFilter = requested === 'upcoming' || requested === 'all' ? requested : 'today'
    // Which day a task falls on is the viewer's question, not the server's:
    // sesh runs in UTC and the browser is the only thing that knows better.
    const clock = dayClock(readTimeZone(params))
    const raw = await loadThingsTasks(conn, filter, clock)

    const tasks = raw
      .filter(task => !isDone(task))
      .map(task => {
        const date = scheduledDate(task)
        const tags = task.tags ?? []
        const kind = dueKind(date, clock)
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
          due: kind,
          dueDate: date ? date.slice(0, 10) : null,
          bucket: bucketOf(task, date, kind),
          areaName: areaName(task),
          // Things has no human-written due string of its own the way Todoist
          // does, so a further-out date is formatted rather than shown raw.
          dueLabel: dueLabel(date, date ? formatDayLabel(date.slice(0, 10)) : null, clock),
          category: tags[0] ?? null,
          completed: false,
        }
      })
      .filter(task => task.id)

    const filtered = filter === 'upcoming' ? tasks.filter(task => task.due !== 'today') : tasks
    // A first connection has more history than one request can replay, so the
    // list can legitimately be short here. Say so rather than let it read as
    // "you have nothing to do".
    return NextResponse.json({ tasks: filtered, syncing: thingsCatchingUp() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

/** Where a new to-do may be filed. Anything else is rejected rather than guessed. */
const WHEN_VALUES = ['today', 'anytime', 'someday', 'inbox'] as const
type When = (typeof WHEN_VALUES)[number]

function readWhen(value: unknown): When {
  return WHEN_VALUES.includes(value as When) ? value as When : 'inbox'
}

export async function POST(request: Request) {
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
    const body = await request.json() as { title?: unknown; when?: unknown }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json({ error: 'A to-do needs a title' }, { status: 400 })
    }
    if (title.length > 500) {
      return NextResponse.json({ error: 'That title is too long' }, { status: 400 })
    }

    // "Today" is the viewer's today: sesh runs in UTC, and scheduling against
    // the server's day would file the to-do a day out for anyone far enough
    // east or west of it.
    const clock = dayClock(readTimeZone(new URL(request.url).searchParams))
    await createThings(conn, { title, when: readWhen(body.when) }, dayStartUtcSeconds(clock.today))

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
