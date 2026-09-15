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
