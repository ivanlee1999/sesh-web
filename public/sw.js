// ── Offline cache (existing) ──────────────────────────────────────────
const CACHE_NAME = 'sesh-v1'
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  if (event.request.url.includes('/api/')) return

  event.respondWith(
    fetch(event.request)
      .then(res => {
        const clone = res.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        return res
      })
      .catch(() => caches.match(event.request))
  )
})

// ── Background timer polling ─────────────────────────────────────────
// Periodically pings /api/timer?background=1 so the server can auto-
// complete expired timers even when the app tab is backgrounded.
// NOTE: This is best-effort — the browser may kill the worker when all
// tabs are closed. Guaranteed completion requires a server-side scheduler.

const TIMER_CHECK_INTERVAL = 30000 // 30 seconds
let checkInterval = null

function startChecking() {
  if (checkInterval) return
  checkInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/timer?background=1', { cache: 'no-store' })
      const data = await res.json()
      // Server flipped to idle — timer was auto-completed, stop polling
      if (data.phase === 'idle') {
        stopChecking()
      }
    } catch {
      // Network error — keep trying
    }
  }, TIMER_CHECK_INTERVAL)
}

function stopChecking() {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'TIMER_STARTED') {
    startChecking()
  } else if (event.data?.type === 'TIMER_STOPPED') {
    stopChecking()
  }
})

// ── Web Push notifications ──────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'sesh', body: 'Session complete!' }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'sesh-timer',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) {
        return clientList[0].focus()
      }
      return clients.openWindow('/')
    })
  )
})
