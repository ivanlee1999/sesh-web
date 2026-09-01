import { NextResponse } from 'next/server'
import { ThingsAuthError, ThingsCloudError } from '@/lib/things-cloud'

/**
 * The one place a Things write turns an upstream failure into a response.
 *
 * Every one of these used to be a bare 502 with the message in the body and
 * nothing written to the log, so a failure in the field left no trace on the
 * server at all and the only evidence was whatever the person managed to read
 * off the screen. It logs, and it distinguishes the two failures that need
 * different things from the reader: credentials that have stopped working are
 * a 401 and are fixed by reconnecting, everything else is the upstream being
 * unhappy and says which status it returned.
 */
export function thingsWriteError(operation: string, id: string, err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : 'Unknown error'
  const status = err instanceof ThingsCloudError ? err.status : undefined
  console.error(`[things] ${operation} failed for ${id}:`, message, status ? `(upstream ${status})` : '')

  if (err instanceof ThingsAuthError) {
    return NextResponse.json(
      { error: 'Things rejected the stored credentials — reconnect in Settings.' },
      { status: 401 },
    )
  }
  return NextResponse.json({ error: message }, { status: 502 })
}
