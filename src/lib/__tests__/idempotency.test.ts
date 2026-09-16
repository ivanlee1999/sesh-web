import type Database from 'better-sqlite3'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Static, despite the mock below: vitest hoists `vi.mock` over the imports, and
// the factory reads `db` lazily, so the module under test sees the test database.
import { IDEMPOTENCY_HEADER, withIdempotency } from '@/lib/idempotency'
import { makeTestDb } from './test-db'

vi.mock('server-only', () => ({}))

let db: Database.Database

vi.mock('@/lib/server-db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server-db')>('@/lib/server-db')
  return { ...actual, getDb: () => db }
})

function request(key?: string): Request {
  return new Request('https://sesh.example/api/todoist/tasks/1/duration', {
    method: 'POST',
    headers: key ? { [IDEMPOTENCY_HEADER]: key } : {},
  })
}

beforeEach(() => {
  db = makeTestDb()
})

describe('withIdempotency', () => {
  it('does the work once and replays the answer thereafter', async () => {
    // The case this exists for: the phone adds 25 minutes to a task, the reply
    // is lost, and it retries. The minutes must not be added twice.
    let calls = 0
    const handler = async () => {
      calls += 1
      return NextResponse.json({ ok: true, total_minutes: 25 * calls })
    }

    const first = await withIdempotency(request('op-1'), handler)
    const second = await withIdempotency(request('op-1'), handler)

    expect(calls).toBe(1)
    expect(await first.json()).toEqual({ ok: true, total_minutes: 25 })
    expect(await second.json()).toEqual({ ok: true, total_minutes: 25 })
    expect(second.headers.get('Idempotent-Replay')).toBe('true')
  })

  it('treats a different key as different work', async () => {
    let calls = 0
    const handler = async () => {
      calls += 1
      return NextResponse.json({ calls })
    }

    await withIdempotency(request('op-1'), handler)
    await withIdempotency(request('op-2'), handler)
    expect(calls).toBe(2)
  })

  it('leaves an unkeyed request exactly as it was', async () => {
    // This is what keeps the existing web app unaffected.
    let calls = 0
    const handler = async () => {
      calls += 1
      return NextResponse.json({ calls })
    }

    await withIdempotency(request(), handler)
    await withIdempotency(request(), handler)
    expect(calls).toBe(2)
    expect(db.prepare('SELECT COUNT(*) c FROM idempotency_keys').get()).toEqual({ c: 0 })
  })

  it('does not pin a failure, so a retry can still succeed', async () => {
    let calls = 0
    const handler = async () => {
      calls += 1
      return calls === 1
        ? NextResponse.json({ error: 'Upstream is down' }, { status: 502 })
        : NextResponse.json({ ok: true })
    }

    const first = await withIdempotency(request('op-3'), handler)
    expect(first.status).toBe(502)

    const second = await withIdempotency(request('op-3'), handler)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true })
  })

  it('ignores an implausibly long key rather than storing it', async () => {
    let calls = 0
    const handler = async () => {
      calls += 1
      return NextResponse.json({ calls })
    }

    const long = 'x'.repeat(500)
    await withIdempotency(request(long), handler)
    await withIdempotency(request(long), handler)
    expect(calls).toBe(2)
  })
})

describe('two retries of the same key at once', () => {
  it('only lets one of them do the work', async () => {
    // The case this whole file exists for. The handler awaits somebody else's
    // API, so two retries overlap easily — a phone giving up waiting and
    // asking again. Before the claim was staked up front, both passed the
    // check and both added the minutes.
    let started = 0
    // Initialised to a no-op rather than null, so the type stays callable:
    // the executor runs synchronously, so it is always the real resolver by
    // the time anything uses it.
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })

    const handler = async () => {
      started += 1
      await gate
      return NextResponse.json({ ok: true, total_minutes: 25 })
    }

    const first = withIdempotency(request('op-race'), handler)
    const second = await withIdempotency(request('op-race'), handler)

    // The second caller is told it is already happening rather than doing it.
    expect(second.status).toBe(409)
    expect(second.headers.get('Idempotent-Replay')).toBe('in-progress')
    expect(started).toBe(1)

    release()
    expect((await first).status).toBe(200)

    // Once it has finished, the answer is replayed rather than recomputed.
    const third = await withIdempotency(request('op-race'), handler)
    expect(started).toBe(1)
    expect(await third.json()).toEqual({ ok: true, total_minutes: 25 })
  })

  it('does not pin the key when the handler throws', async () => {
    const boom = async (): Promise<NextResponse> => { throw new Error('upstream exploded') }
    await expect(withIdempotency(request('op-throw'), boom)).rejects.toThrow('upstream exploded')

    // A thrown request must leave the key free, or one blow-up would block
    // that operation for a week.
    let calls = 0
    const ok = async () => { calls += 1; return NextResponse.json({ ok: true }) }
    const retry = await withIdempotency(request('op-throw'), ok)
    expect(retry.status).toBe(200)
    expect(calls).toBe(1)
  })
})
