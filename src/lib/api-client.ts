'use client'

export async function readApiError(response: Response, fallback: string): Promise<string> {
  let detail = ''

  try {
    const type = response.headers.get('content-type') ?? ''
    if (type.includes('application/json')) {
      const data = await response.clone().json()
      detail = typeof data?.error === 'string'
        ? data.error
        : typeof data?.message === 'string'
          ? data.message
          : ''
    } else {
      detail = (await response.clone().text()).trim()
    }
  } catch {
    detail = ''
  }

  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
  const suffix = detail ? `${status}: ${detail}` : status
  return `${fallback} (${suffix})`
}

export function isAuthResponse(response: Response): boolean {
  return response.status === 401
}

export function loginPath(nextPath?: string): string {
  const next = nextPath ?? (typeof window !== 'undefined'
    ? `${window.location.pathname}${window.location.search}`
    : '/')
  return `/login?next=${encodeURIComponent(next || '/')}`
}

export function redirectToLogin(nextPath?: string) {
  if (typeof window === 'undefined') return
  window.location.assign(loginPath(nextPath))
}
