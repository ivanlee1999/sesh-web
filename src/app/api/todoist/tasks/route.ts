import { NextResponse } from 'next/server'
import { isTodoistConfigured, listTodayTasks } from '@/lib/todoist'
import { getClientIp, isRateLimited } from '@/lib/todoist-ratelimit'
import { validateTodoistAuth } from '@/lib/todoist-auth'

export const dynamic = 'force-dynamic'

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
    const data = await listTodayTasks()
    return NextResponse.json({
      tasks: data.map(task => ({
        id: String(task.id),
        content: task.content,
        duration: task.duration,
        labels: task.labels ?? [],
        priority: task.priority ?? 1,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
