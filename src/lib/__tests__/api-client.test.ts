import { describe, expect, it } from 'vitest'
import { readApiError } from '@/lib/api-client'

function response(body: string, { status = 502, statusText = 'Bad Gateway', type = 'text/plain' } = {}) {
  return new Response(body, { status, statusText, headers: { 'Content-Type': type } })
}

/** The shape sesh actually received through the Cloudflare tunnel. */
const CLOUDFLARE_502 = `<!DOCTYPE html>
<html class="no-js" lang="en-US">
<head> <title>liyifan.us | 502: Bad gateway</title> </head>
<body><div id="cf-wrapper"><h1>Bad gateway<span class="code-label">Error code 502</span></h1>
${'<p class="filler">Performance &amp; security by Cloudflare</p>'.repeat(80)}
</div></body></html>`

describe('readApiError', () => {
  it('reports a gateway error by its status, not by its HTML page', async () => {
    const message = await readApiError(
      response(CLOUDFLARE_502, { type: 'text/html; charset=UTF-8' }),
      'Failed to record focus time',
    )

    expect(message).toBe('Failed to record focus time (502 Bad Gateway)')
    expect(message).not.toContain('<')
    expect(message).not.toContain('Cloudflare')
  })

  it('recognises an error page even when the proxy mislabels its content type', async () => {
    const message = await readApiError(response(CLOUDFLARE_502), 'Failed to close Things task')
    expect(message).toBe('Failed to close Things task (502 Bad Gateway)')
  })

  it('keeps the error the API itself reports', async () => {
    const message = await readApiError(
      response(JSON.stringify({ error: 'Things not configured' }), { status: 503, statusText: '', type: 'application/json' }),
      'Failed to load tasks',
    )
    expect(message).toBe('Failed to load tasks (503: Things not configured)')
  })

  it('keeps a short plain-text body, which is usually the real reason', async () => {
    const message = await readApiError(response('upstream connect timeout', { status: 504, statusText: 'Gateway Timeout' }), 'Failed to sync')
    expect(message).toBe('Failed to sync (504 Gateway Timeout: upstream connect timeout)')
  })

  it('flattens a multi-line body onto one line', async () => {
    const message = await readApiError(response('Error: boom\n    at thing (file.ts:1:1)', { status: 500, statusText: '' }), 'Failed')
    expect(message).toBe('Failed (500: Error: boom at thing (file.ts:1:1))')
  })

  it('truncates a body too long to belong in a notice', async () => {
    const message = await readApiError(response('x'.repeat(500), { status: 500, statusText: '' }), 'Failed')
    expect(message).toContain('...')
    expect(message.length).toBeLessThan(240)
  })

  it('falls back to the status alone when there is no body', async () => {
    expect(await readApiError(response('', { status: 500, statusText: 'Internal Server Error' }), 'Failed'))
      .toBe('Failed (500 Internal Server Error)')
  })
})
