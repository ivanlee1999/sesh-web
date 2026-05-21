import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPushSubscriptionConfirmed, ensurePushSubscription, isInstalledPwa, isPushSupported } from '../push-client'

describe('push-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()

    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({ matches: false }),
      writable: true,
      configurable: true,
    })

    Object.defineProperty(window.navigator, 'standalone', {
      value: false,
      writable: true,
      configurable: true,
    })

    Object.defineProperty(window, 'PushManager', {
      value: function PushManager() {},
      writable: true,
      configurable: true,
    })

    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
            subscribe: vi.fn().mockResolvedValue({
              endpoint: 'https://web.push.apple.com/test',
              keys: { p256dh: 'p256dh', auth: 'auth' },
            }),
          },
        }),
      },
      writable: true,
      configurable: true,
    })

    Object.defineProperty(globalThis, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      writable: true,
      configurable: true,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      if (url === '/api/push/vapid') {
        return new Response(JSON.stringify({ publicKey: 'SGVsbG8' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/push/subscribe' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200 })
    })
  })

  it('detects push support from browser APIs', () => {
    expect(isPushSupported()).toBe(true)
  })

  it('detects installed PWA from standalone display mode', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({ matches: true }),
      writable: true,
      configurable: true,
    })

    expect(isInstalledPwa()).toBe(true)
  })

  it('requests permission before fetching the VAPID key when asked', async () => {
    const calls: string[] = []
    const requestPermission = vi.fn().mockImplementation(async () => {
      calls.push('permission')
      return 'granted'
    })

    Object.defineProperty(globalThis, 'Notification', {
      value: {
        permission: 'default',
        requestPermission,
      },
      writable: true,
      configurable: true,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      if (url === '/api/push/vapid') calls.push('vapid')
      if (url === '/api/push/subscribe' && init?.method === 'POST') calls.push('subscribe')
      if (url === '/api/push/vapid') {
        return new Response(JSON.stringify({ publicKey: 'SGVsbG8' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await expect(ensurePushSubscription({ requestPermission: true })).resolves.toBe(true)
    expect(calls).toEqual(['permission', 'vapid', 'subscribe'])
    expect(localStorage.getItem('pushSubscriptionConfirmed')).toBe('1')
  })

  it('does not prompt by default when permission is still default', async () => {
    await expect(ensurePushSubscription()).resolves.toBe(false)
    expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled()
  })

  it('clears the confirmation flag', () => {
    localStorage.setItem('pushSubscriptionConfirmed', '1')
    clearPushSubscriptionConfirmed()
    expect(localStorage.getItem('pushSubscriptionConfirmed')).toBeNull()
  })
})
