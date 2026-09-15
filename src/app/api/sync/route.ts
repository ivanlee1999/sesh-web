import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'
import { applyOps, pruneSyncOps, pullChanges, type SyncOp } from '@/lib/sync'
import { runCompletionSideEffects } from '@/lib/session-complete'
import { deleteSessionCalendarEvent } from '@/lib/google-calendar'
import { rowToTimerJson, type TimerRow } from '@/lib/timer-notifications'

export const dynamic = 'force-dynamic'

/** More than a client should ever need in one go, and a bound on the damage a bad one can do. */
const MAX_OPS = 200

/**
 * One exchange: push what happened away from the network, pull what happened
 * without you.
 *
 * Both halves in a single request because they are one question — "bring us
 * level" — and splitting them would let a client pull a view of the world that
 * does not yet include the work it is about to push, then have to reconcile
 * the difference itself.
 *
 * The push runs first for the same reason: the changes returned then already
 * account for the client's own operations, so the reply is the truth as of
 * after they landed, not before.
 */
export async function POST(request: Request) {
  try {
    const db = getDb()
    const body = await request.json().catch(() => ({})) as {
      deviceId?: unknown
      cursor?: unknown
      limit?: unknown
      ops?: unknown
    }

    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 64) : ''
    const cursor = Number(body.cursor) || 0
    const limit = Number(body.limit) || undefined
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, MAX_OPS) as SyncOp[] : []

    const { results, effects } = applyOps(db, ops, deviceId)
    const pull = pullChanges(db, cursor, limit)
    const timerRow = db.prepare('SELECT * FROM timer_state WHERE id = 1').get() as TimerRow | undefined

    /*
     * Side effects after the writes are committed and, deliberately, after the
     * cursor has been read: a session that arrives from a phone still earns its
     * calendar entry and its minutes written back to Things, but a slow or
     * broken upstream must not delay — or fail — a sync that has already been
     * durably applied. Failures are logged inside each helper.
     */
    void runPendingEffects(effects)

    // Cheap, and it keeps the replay guard from growing without limit.
    pruneSyncOps(db)

    return NextResponse.json({
      results,
      changes: pull.changes,
      cursor: pull.cursor,
      hasMore: pull.hasMore,
      timer: timerRow ? { ...rowToTimerJson(timerRow), deviceId: timerRow.device_id ?? '' } : null,
      serverTime: Date.now(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[sync] request failed:', message)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}

async function runPendingEffects(effects: Awaited<ReturnType<typeof applyOps>>['effects']): Promise<void> {
  for (const effect of effects) {
    try {
      if (effect.kind === 'deleted') {
        await deleteSessionCalendarEvent(effect.session.googleEventId ?? '')
        continue
      }
      await runCompletionSideEffects(effect.session, {
        isNew: effect.isNew,
        /*
         * The device that ran the session has already told its owner it was
         * over, on its own screen, offline. Broadcasting a push now would alert
         * them a second time about a session they finished an hour ago — so the
         * announcement is left to the devices that were not there.
         */
        notify: false,
      })
    } catch (err) {
      console.error('[sync] side effect failed:', err)
    }
  }
}
