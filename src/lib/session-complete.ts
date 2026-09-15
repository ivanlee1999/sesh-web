import { sendPushToAll } from '@/lib/push'
import { isTodoistConfigured, addTaskDuration } from '@/lib/todoist'
import { readThingsConfig } from '@/lib/things-config'
import { recordThingsFocus } from '@/lib/things-service'
import { decodeTaskRefs } from '@/lib/task-ref'
import { syncSessionToGoogleCalendar, persistCalendarSyncResult } from '@/lib/google-calendar'
import { sendDiscordNotification } from '@/lib/timer-notifications'

/**
 * Everything that happens *because* a session finished, as opposed to the row
 * that records it.
 *
 * Extracted from the timer route because a session no longer only finishes
 * there. One completed on a phone with no signal arrives later through
 * `/api/sync`, having never touched `timer_state`, and it has the same claim
 * on the calendar entry and the minutes written back to its tasks as one
 * finished with the tab open. Two copies of this would have drifted.
 *
 * Every step is non-fatal and none of it belongs inside the transaction that
 * wrote the row: these are calls to other people's servers, and a session that
 * is safely recorded must not be rolled back because Discord was down.
 */
export interface CompletedSession {
  id: string
  intention: string
  category: string
  type: string
  targetMs: number
  actualMs: number
  overflowMs: number
  startedAt: number
  endedAt: number
  notes: string
  rating?: number
  todoistTaskId?: string | null
  /**
   * The calendar entry this session already has, when it has one. Passing it
   * is what makes a re-sync update that entry instead of leaving a second one
   * beside it — so callers editing an existing session should read it back off
   * the stored row rather than letting it default.
   */
  googleEventId?: string
  isSynced?: boolean
}

export interface CalendarOutcome {
  synced: boolean
  skipped?: string
  eventId?: string
  error?: string
}

/**
 * Record focused time against the linked tasks (non-fatal).
 *
 * A session can be against several, and each stored reference may belong to a
 * different provider — so decode before dispatching, or a Things uuid would go
 * to Todoist and 404 on every session.
 *
 * One task failing must not stop the rest, hence a settled loop rather than a
 * fail-fast Promise.all.
 */
export async function syncTaskDuration(taskRefs: string | null | undefined, actualMs: number) {
  const minutes = Math.round(actualMs / 60000)
  if (minutes <= 0) return

  await Promise.all(decodeTaskRefs(taskRefs).map(async ref => {
    try {
      if (ref.provider === 'todoist') {
        if (!isTodoistConfigured()) return
        await addTaskDuration(ref.id, minutes)
        return
      }
      const conn = readThingsConfig()
      if (!conn) return
      await recordThingsFocus(conn, ref.id, minutes)
    } catch (err) {
      console.error(`[${ref.provider}] Failed to sync duration:`, err)
    }
  }))
}

export interface SideEffectOptions {
  /**
   * Whether this is the first time the session has been recorded. A session
   * arriving again — an edited title, a rating added after the fact, a replayed
   * op — must not announce itself twice or add its minutes to a task a second
   * time. The calendar is the exception: it is keyed by event id, so syncing
   * again updates the entry rather than making another.
   */
  isNew: boolean
  /** Suppress the push broadcast (a phone has already alerted itself locally). */
  notify?: boolean
}

export async function runCompletionSideEffects(
  session: CompletedSession,
  options: SideEffectOptions,
): Promise<{ calendar?: CalendarOutcome }> {
  const { isNew, notify = true } = options

  if (isNew) {
    sendDiscordNotification({
      intention: session.intention,
      sessionType: session.type,
      targetMs: session.targetMs,
      overflowMs: session.overflowMs,
    })

    if (notify) {
      await sendPushToAll(
        'sesh — session complete',
        session.intention || `${session.type} session finished`,
      )
    }

    if (session.todoistTaskId) {
      // Deliberately not awaited: the minutes are written to somebody else's
      // API and the response the caller is waiting on should not be held up by
      // it. Failures are logged inside.
      void syncTaskDuration(session.todoistTaskId, session.actualMs)
    }
  }

  const calendar = await syncSessionToGoogleCalendar({
    ...session,
    googleEventId: session.googleEventId ?? '',
    isSynced: session.isSynced ?? false,
  })
  if (calendar) persistCalendarSyncResult(session.id, calendar)

  return { calendar }
}
