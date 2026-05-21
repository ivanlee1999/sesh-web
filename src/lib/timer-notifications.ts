import { getDb } from '@/lib/server-db'
import { sendPushToAll } from '@/lib/push'
import {
  buildOverflowNotification,
  shouldTimerNotificationSchedulerRun,
  type OverflowNotification,
  type TimerRow,
} from '@/lib/timer-notification-logic'

export {
  buildOverflowNotification,
  nextOverflowNotificationThresholdMinutes,
  rowToTimerJson,
  shouldTimerNotificationSchedulerRun,
  type OverflowNotification,
  type TimerRow,
} from '@/lib/timer-notification-logic'

const TIMER_NOTIFICATION_INTERVAL_MS = 30_000

type TimerNotificationSchedulerState = {
  interval: ReturnType<typeof setInterval> | null
  running: boolean
}

const globalForTimerNotifications = globalThis as typeof globalThis & {
  __seshTimerNotifications?: TimerNotificationSchedulerState
}

const schedulerState = globalForTimerNotifications.__seshTimerNotifications ??= {
  interval: null,
  running: false,
}

export function sendDiscordNotification(notification: {
  intention: string
  sessionType: string
  targetMs: number
  overflowMs: number
  isFirst?: boolean
  overflowMins?: number
}) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  if (!webhookUrl) return

  const duration = Math.round(notification.targetMs / 60000)
  const overflow = Math.round(notification.overflowMs / 60000)

  let msg: string
  if (notification.isFirst !== undefined) {
    // Overflow notification (target reached or reminder)
    if (notification.isFirst) {
      msg = notification.intention
        ? `⏰ **Target reached:** "${notification.intention}" (${duration}min ${notification.sessionType}) — timer still running`
        : `⏰ **${notification.sessionType} target reached** (${duration}min) — timer still running`
    } else {
      msg = notification.intention
        ? `⏰ **Still going:** "${notification.intention}" — +${notification.overflowMins}min overtime`
        : `⏰ **Still going:** +${notification.overflowMins}min overtime on ${notification.sessionType}`
    }
  } else {
    // Manual finish notification
    msg = notification.intention
      ? `✅ **Session complete:** "${notification.intention}" (${duration}min ${notification.sessionType}${overflow > 0 ? `, +${overflow}min overflow` : ''})`
      : `✅ **${notification.sessionType} session complete** (${duration}min${overflow > 0 ? `, +${overflow}min overflow` : ''})`
  }

  void fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: msg }),
  }).catch(() => {})
}

export async function dispatchOverflowNotification(notification: OverflowNotification) {
  sendDiscordNotification(notification)
  if (notification.isFirst) {
    await sendPushToAll(
      'sesh — session complete',
      notification.intention
        ? `"${notification.intention}" — target reached! Timer still running.`
        : `${notification.sessionType} target reached! Timer still running.`
    )
  } else {
    await sendPushToAll(
      'sesh — still going',
      notification.intention
        ? `"${notification.intention}" — +${notification.overflowMins}min overtime`
        : `+${notification.overflowMins}min overtime on ${notification.sessionType}`
    )
  }
}

/**
 * Check and send a due overflow notification using notification_count as a CAS guard
 * so concurrent API requests and the background scheduler cannot duplicate sends.
 */
export async function checkAndSendOverflowNotifications() {
  const db = getDb()
  const selectTimer = db.prepare('SELECT * FROM timer_state WHERE id = 1')
  const updateNotificationCount = db.prepare(
    'UPDATE timer_state SET notification_count = ? WHERE id = 1 AND notification_count = ?'
  )

  const row = selectTimer.get() as TimerRow
  const notification = buildOverflowNotification(row)
  if (!notification) return { notify: false, row }

  const currentCount = row.notification_count
  const result = updateNotificationCount.run(currentCount + 1, currentCount)
  if (result.changes === 0) return { notify: false, row }

  await dispatchOverflowNotification(notification)
  return { notify: true, row, notification }
}

async function schedulerTick() {
  if (schedulerState.running) return
  schedulerState.running = true
  try {
    const result = await checkAndSendOverflowNotifications()
    if (!shouldTimerNotificationSchedulerRun(result.row)) {
      stopTimerNotificationScheduler()
    }
  } catch (err) {
    console.error('[timer-notifications] scheduler tick failed:', err)
  } finally {
    schedulerState.running = false
  }
}

export function ensureTimerNotificationScheduler() {
  if (schedulerState.interval) return
  schedulerState.interval = setInterval(() => {
    void schedulerTick()
  }, TIMER_NOTIFICATION_INTERVAL_MS)

  // Do an immediate async check so short timers do not wait for the first interval
  // after a process restart or API request imports this module.
  void schedulerTick()
}

export function stopTimerNotificationScheduler() {
  if (!schedulerState.interval) return
  clearInterval(schedulerState.interval)
  schedulerState.interval = null
}

export async function ensureSchedulerForCurrentTimer() {
  try {
    const db = getDb()
    const row = db.prepare('SELECT * FROM timer_state WHERE id = 1').get() as TimerRow | undefined
    if (shouldTimerNotificationSchedulerRun(row)) {
      ensureTimerNotificationScheduler()
    } else {
      stopTimerNotificationScheduler()
    }
  } catch (err) {
    console.error('[timer-notifications] failed to initialize scheduler:', err)
  }
}

