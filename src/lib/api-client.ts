'use client'

/**
 * Longest upstream detail worth showing. A real API error is a sentence; past
 * this it is a document, and a notice is not the place to read one.
 */
const MAX_DETAIL_LENGTH = 200

/**
 * Whether a body is a machine's error page rather than a message for a person.
 *
 * sesh sits behind a tunnel and a CDN, either of which answers a bad gateway
 * with a full HTML page. That page says nothing the status line does not, and
 * putting it in a notice buried "Failed to record focus time" under eight
 * kilobytes of Cloudflare markup.
 */
function isMarkup(type: string, body: string): boolean {
  return type.includes('text/html') || body.startsWith('<')
}

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
      const body = (await response.clone().text()).trim()
      // Proxies mislabel their content type often enough to check the body too.
      detail = isMarkup(type, body) ? '' : body
    }
  } catch {
    detail = ''
  }

  // One line, whatever arrived: a stack trace or a multi-line message would
  // otherwise stretch the notice down the screen.
  detail = detail.replace(/\s+/g, ' ').trim()
  if (detail.length > MAX_DETAIL_LENGTH) {
    detail = `${detail.slice(0, MAX_DETAIL_LENGTH).trimEnd()}...`
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
