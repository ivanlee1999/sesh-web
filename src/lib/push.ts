import 'server-only'
import webpush from 'web-push'
import { getDb } from './server-db'

type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
}

export function sendPushToAll(title: string, body: string) {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  const vapidSubject = process.env.VAPID_SUBJECT
  if (!vapidPublic || !vapidPrivate || !vapidSubject) return

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  const db = getDb()
  const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as PushSubscriptionRow[]

  for (const sub of subs) {
    webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title, body })
    ).catch((error: { statusCode?: number }) => {
      // Only remove subscriptions that are permanently invalid
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint)
      }
    })
  }
}
