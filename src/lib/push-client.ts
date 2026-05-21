const PUSH_SUBSCRIPTION_CONFIRMED_KEY = 'pushSubscriptionConfirmed'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function isInstalledPwa() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function clearPushSubscriptionConfirmed() {
  try {
    localStorage.removeItem(PUSH_SUBSCRIPTION_CONFIRMED_KEY)
  } catch {}
}

function markPushSubscriptionConfirmed() {
  try {
    localStorage.setItem(PUSH_SUBSCRIPTION_CONFIRMED_KEY, '1')
  } catch {}
}

export async function ensurePushSubscription({ requestPermission = false }: { requestPermission?: boolean } = {}) {
  if (!isPushSupported()) return false

  let permission = Notification.permission
  if (permission === 'default') {
    if (!requestPermission) return false
    permission = await Notification.requestPermission()
  }

  if (permission !== 'granted') {
    clearPushSubscriptionConfirmed()
    return false
  }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  let createdSubscription = false

  if (!sub) {
    const vapidRes = await fetch('/api/push/vapid', { cache: 'no-store' })
    const { publicKey } = await vapidRes.json()
    if (!publicKey) throw new Error('Missing public key')

    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
    createdSubscription = true
  }

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  })

  if (!res.ok) {
    if (createdSubscription) {
      await sub.unsubscribe().catch(() => {})
    }
    clearPushSubscriptionConfirmed()
    throw new Error('Server failed to save push subscription')
  }

  markPushSubscriptionConfirmed()
  return true
}
