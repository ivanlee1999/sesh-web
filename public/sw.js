// ── Offline cache ────────────────────────────────────────────────────────
const CACHE_NAME = 'sesh-v2'
const API_CACHE_NAME = 'sesh-api-v1'

// Static assets to precache on install
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
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== API_CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  // ── API GET requests: stale-while-revalidate ──
  if (url.pathname.startsWith('/api/')) {
    // Skip background timer checks — those shouldn't be cached
    if (url.searchParams.has('background')) return

    event.respondWith(
      caches.open(API_CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request)
        const fetchPromise = fetch(event.request)
          .then(res => {
            if (res.ok) {
              cache.put(event.request, res.clone())
            }
            return res
          })
          .catch(() => cached)

        // Return cached response immediately if available, otherwise wait
        return cached || fetchPromise
      })
    )
    return
  }

  // ── Static assets: cache-first, update in background ──
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request)
      if (cached) {
        // Update cache in background
        fetch(event.request)
          .then(res => {
            if (res.ok) cache.put(event.request, res.clone())
          })
          .catch(() => {})
        return cached
      }
      // Not cached yet — fetch, cache, return
      try {
        const res = await fetch(event.request)
        if (res.ok) cache.put(event.request, res.clone())
        return res
      } catch {
        // Completely offline and not cached
        return new Response('Offline', { status: 503, statusText: 'Offline' })
      }
    })
  )
})

// ── Background timer polling ─────────────────────────────────────────
// Periodically pings /api/timer?background=1 so the server can send
// overflow reminder notifications even when the app tab is backgrounded.
// The timer never auto-completes — only manual finish stops it.
// NOTE: This is best-effort — the browser may kill the worker when all
// tabs are closed.

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
