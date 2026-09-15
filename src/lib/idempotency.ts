import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server-db'

/** A week is far longer than any client will retry for, and keeps the table small. */
const KEY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_KEY_LENGTH = 128

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

/**
 * Make a write safe to repeat.
 *
 * The task routes are commands to somebody else's server — close this to-do,
 * add twenty-five minutes to that one — and unlike a row write they cannot be
 * made idempotent by writing the same thing twice. Adding minutes accumulates;
 * creating a Things to-do makes another one, because Things does not merge
 * creates. A phone that sends one of these and then loses the reply has no way
 * to know whether it landed.
 *
 * So the client names the attempt, and the first answer is kept and replayed.
 * Only successes are stored: a failure is worth retrying, and pinning one would
 * mean a transient outage permanently poisoned that operation.
 *
 * A request without the header behaves exactly as it always did, which is what
 * keeps the PWA unaffected.
 */
export async function withIdempotency(
  request: Request,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim()
  if (!key || key.length > MAX_KEY_LENGTH) {
    return handler()
  }

  const db = getDb()
  const existing = db.prepare('SELECT status, body FROM idempotency_keys WHERE key = ?').get(key) as
    { status: number; body: string } | undefined

  if (existing) {
    return new NextResponse(existing.body, {
      status: existing.status,
      headers: { 'Content-Type': 'application/json', 'Idempotent-Replay': 'true' },
    })
  }

  const response = await handler()

  if (response.status >= 200 && response.status < 300) {
    try {
      const body = await response.clone().text()
      db.prepare(
        'INSERT OR REPLACE INTO idempotency_keys (key, status, body, created_at) VALUES (?, ?, ?, ?)',
      ).run(key, response.status, body, Date.now())
    } catch (err) {
      // The work is done either way; failing to remember it only costs a
      // possible repeat, which is better than failing the request now.
      console.error('[idempotency] failed to store result:', err)
    }
    db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(Date.now() - KEY_RETENTION_MS)
  }

  return response
}
