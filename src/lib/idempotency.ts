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

  /*
   * The claim is staked before the work, not after it.
   *
   * Checking for a stored result and only writing one afterwards leaves the
   * whole duration of the request open: this handler awaits somebody else's
   * API, so two retries of the same key overlap easily — exactly what happens
   * when a phone gives up waiting and asks again. Both would pass an
   * empty check and both would add the minutes.
   *
   * `INSERT OR IGNORE` decides it instead. The row is the claim; whoever wins
   * it does the work, and everyone else is looking at a claim that is either
   * finished (replay it) or still running (say so, and let them retry).
   */
  const claimed = db.prepare(
    'INSERT OR IGNORE INTO idempotency_keys (key, status, body, created_at) VALUES (?, 0, \'\', ?)',
  ).run(key, Date.now())

  if (claimed.changes === 0) {
    const existing = db.prepare('SELECT status, body FROM idempotency_keys WHERE key = ?').get(key) as
      { status: number; body: string } | undefined

    if (existing && existing.status > 0) {
      return new NextResponse(existing.body, {
        status: existing.status,
        headers: { 'Content-Type': 'application/json', 'Idempotent-Replay': 'true' },
      })
    }

    // Claimed but unfinished: the first attempt is still out there. Saying so
    // is honest, and 409 is something a queue already knows how to retry.
    return NextResponse.json(
      { error: 'That request is already in progress' },
      { status: 409, headers: { 'Idempotent-Replay': 'in-progress' } },
    )
  }

  let response: NextResponse
  try {
    response = await handler()
  } catch (err) {
    // Release the claim, or one thrown request would pin this key for a week.
    db.prepare('DELETE FROM idempotency_keys WHERE key = ?').run(key)
    throw err
  }

  if (response.status >= 200 && response.status < 300) {
    try {
      const body = await response.clone().text()
      db.prepare('UPDATE idempotency_keys SET status = ?, body = ? WHERE key = ?')
        .run(response.status, body, key)
    } catch (err) {
      // The work is done either way; failing to remember it only costs a
      // possible repeat, which is better than failing the request now.
      console.error('[idempotency] failed to store result:', err)
    }
    db.prepare('DELETE FROM idempotency_keys WHERE created_at < ? AND status > 0').run(Date.now() - KEY_RETENTION_MS)
  } else {
    // A failure is worth retrying, so it must not hold the key.
    db.prepare('DELETE FROM idempotency_keys WHERE key = ?').run(key)
  }

  return response
}
