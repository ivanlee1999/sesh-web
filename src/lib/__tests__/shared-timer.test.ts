import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb } from './test-db'
import { applyOps } from '@/lib/sync'
import { timerGuardMatches, validateGuardedTimer, writeTimerState } from '@/lib/timer-state'

let db: Database.Database
const now = 1_800_000_000_000
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); db = makeTestDb() })
afterEach(() => { db.close(); vi.restoreAllMocks() })
const row = () => db.prepare('SELECT * FROM timer_state').get() as Record<string, number | string | null>
function input(extra: Record<string, unknown> = {}) {
  return { phase: 'running', sessionType: 'focus', intention: 'Fixture', category: 'other', targetMs: 600_000,
    remainingMs: 600_000, overflowMs: 0, startedAt: now, pausedAt: null, recordedAt: now,
    expectedUpdatedAt: 0, expectedStartedAt: null, ...extra }
}
function mirror(id: string, payload = input(), device = 'phone') {
  return applyOps(db, [{ opId: id, kind: 'timer.mirror', payload }], device).results[0]
}

describe('guarded shared live timer', () => {
  it('one of two simultaneous starts wins and rejected retries preserve the conflict', () => {
    const winner = mirror('first')
    expect(winner.status).toBe('applied')
    const loser = mirror('other', input({ startedAt: now + 1 }))
    expect(loser).toMatchObject({ status: 'stale', timerConflict: true, timerUpdatedAt: winner.timerUpdatedAt, timerStartedAt: now })
    expect(mirror('other')).toMatchObject({ status: 'duplicate', timerConflict: true })
    expect(row().started_at).toBe(now)
  })
  it('a lost successful response can be retried without restarting the countdown', () => {
    const first = mirror('start')
    vi.mocked(Date.now).mockReturnValue(now + 100_000)
    expect(mirror('start')).toMatchObject({ ...first, status: 'duplicate' })
    expect(row().remaining_ms).toBe(600_000)
    expect(row().updated_at).toBe(now)
  })
  it('deducts offline transit time and keeps original start identity', () => {
    vi.mocked(Date.now).mockReturnValue(now + 120_000)
    const receipt = mirror('offline')
    expect(receipt.status).toBe('applied')
    expect(row()).toMatchObject({ started_at: now, remaining_ms: 480_000, updated_at: now + 120_000 })
  })
  it('an offline countdown may arrive already in overtime', () => {
    vi.mocked(Date.now).mockReturnValue(now + 700_000)
    mirror('offline')
    expect(row()).toMatchObject({ remaining_ms: -100_000, overflow_ms: 100_000 })
  })
  it('offline pauses do not keep counting during transport', () => {
    vi.mocked(Date.now).mockReturnValue(now + 120_000)
    mirror('pause', input({ phase: 'paused', pausedAt: now, remainingMs: 450_000 }))
    expect(row().remaining_ms).toBe(450_000)
  })
  it('orders successive same-millisecond transitions using unique versions', () => {
    const a = mirror('start')
    const b = mirror('pause', input({ afterTimerOpId: 'start', phase: 'paused', pausedAt: now }))
    const c = mirror('resume', input({ afterTimerOpId: 'pause' }))
    expect([a, b, c].map(x => x.status)).toEqual(['applied', 'applied', 'applied'])
    expect(new Set([a.timerUpdatedAt, b.timerUpdatedAt, c.timerUpdatedAt]).size).toBe(3)
    expect(c.timerStartedAt).toBe(now)
  })
  it('another device invalidates an offline causal chain', () => {
    const a = mirror('start')
    mirror('mac', input({ expectedUpdatedAt: a.timerUpdatedAt, expectedStartedAt: now, phase: 'paused', pausedAt: now }), 'mac')
    expect(mirror('old-resume', input({ afterTimerOpId: 'start' }))).toMatchObject({ status: 'stale', timerConflict: true })
    expect(row().phase).toBe('paused')
  })
  it('a rejected parent cannot authorize dependent commands', () => {
    mirror('winner')
    mirror('loser', input({ startedAt: now + 10 }))
    expect(mirror('dependent', input({ afterTimerOpId: 'loser' }))).toMatchObject({ status: 'stale', timerConflict: true })
  })
  it('a missing or different-device predecessor cannot authorize a write', () => {
    mirror('start')
    expect(mirror('missing', input({ afterTimerOpId: 'unknown' }))).toMatchObject({ status: 'stale', timerConflict: true })
    expect(mirror('stolen', input({ afterTimerOpId: 'start' }), 'mac')).toMatchObject({ status: 'stale', timerConflict: true })
  })
  it('cannot resurrect a stopped session with an old version', () => {
    const a = mirror('start')
    mirror('stop', input({ afterTimerOpId: 'start', phase: 'idle', startedAt: null }))
    expect(mirror('late', input({ expectedUpdatedAt: a.timerUpdatedAt, expectedStartedAt: now }))).toMatchObject({ status: 'stale', timerConflict: true })
    expect(row().phase).toBe('idle')
  })
  it('checks original start identity even if version matches', () => {
    const a = mirror('start')
    expect(mirror('wrong', input({ expectedUpdatedAt: a.timerUpdatedAt, expectedStartedAt: now - 1 }))).toMatchObject({ status: 'stale', timerConflict: true })
  })
  it('completion clears only its own sitting and returns a causal timer receipt', () => {
    mirror('start')
    const result = applyOps(db, [{ opId: 'complete', kind: 'session.complete', payload: {
      id: `manual-${now}`, startedAt: now, endedAt: now + 30_000, category: 'other', targetMs: 600_000,
    } }], 'phone').results[0]
    expect(result).toMatchObject({ status: 'applied', timerStartedAt: null })
    expect(mirror('break', input({ afterTimerOpId: 'complete', sessionType: 'break', startedAt: now + 30_000 }))).toMatchObject({ status: 'applied' })
    expect(row().started_at).toBe(now + 30_000)
  })
  it('late completion does not clear a newer break', () => {
    mirror('start')
    mirror('break', input({ afterTimerOpId: 'start', sessionType: 'break', startedAt: now + 30_000 }))
    const result = applyOps(db, [{ opId: 'complete', kind: 'session.complete', payload: {
      id: `manual-${now}`, startedAt: now, endedAt: now + 30_000, category: 'other',
    } }], 'phone').results[0]
    expect(result.timerStartedAt).toBe(now + 30_000)
    expect(row().phase).toBe('running')
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 })
  })
  it('guarded completion conflict cannot record history or fire side effects', () => {
    const started = mirror('start')
    mirror('pause', input({ afterTimerOpId: 'start', phase: 'paused', pausedAt: now }))
    const completion = applyOps(db, [{ opId: 'finish', kind: 'session.complete', payload: {
      id: `manual-${now}`, startedAt: now, expectedUpdatedAt: started.timerUpdatedAt, expectedStartedAt: now,
    } }], 'phone')
    expect(completion.results[0]).toMatchObject({ status: 'stale', timerConflict: true })
    expect(completion.effects).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
    expect(row().phase).toBe('paused')
  })
  it('completion may save old focus against its acknowledged new break without clearing the break', () => {
    mirror('start')
    mirror('break', input({ afterTimerOpId: 'start', sessionType: 'break', startedAt: now + 30_000 }))
    const completion = applyOps(db, [{ opId: 'finish', kind: 'session.complete', payload: {
      id: `manual-${now}`, startedAt: now, afterTimerOpId: 'break', endedAt: now + 30_000,
    } }], 'phone')
    expect(completion.results[0]).toMatchObject({ status: 'applied', timerStartedAt: now + 30_000 })
    expect(row().phase).toBe('running')
  })
  it('a fresh baseline cannot resurrect an earlier active sitting', () => {
    mirror('start', input({ startedAt: now + 30_000 }))
    expect(mirror('resurrect', input({ afterTimerOpId: 'start', startedAt: now }))).toMatchObject({ status: 'stale', timerConflict: true })
    expect(row().started_at).toBe(now + 30_000)
  })
  it('explicit journal-only recovery bypasses guards without touching the active timer', () => {
    mirror('mac', input({ startedAt: now + 30_000 }), 'mac')
    const before = row()
    const completion = { opId: 'recovery', kind: 'session.complete', payload: {
      journalOnly: true, id: `manual-${now}`, startedAt: now, endedAt: now + 10_000, intention: 'Recovered offline work',
      expectedUpdatedAt: 0, expectedStartedAt: null,
    } }
    const first = applyOps(db, [completion], 'phone')
    expect(first.results[0]).toMatchObject({ status: 'applied', timerChainAllowed: false })
    expect(first.effects).toHaveLength(1)
    expect(first.effects[0].isNew).toBe(true)
    expect(row()).toEqual(before)
    const retry = applyOps(db, [completion], 'phone')
    expect(retry.results[0]).toMatchObject({ status: 'duplicate', timerUpdatedAt: before.updated_at, timerStartedAt: before.started_at })
    expect(retry.effects).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 })
    expect(row()).toEqual(before)
    expect(mirror('stale-idle-after-recovery', input({ afterTimerOpId: 'recovery', phase: 'idle', startedAt: null }))).toMatchObject({ status: 'stale', timerConflict: true })
    expect(row()).toEqual(before)
  })
  it('journal-only recovery rejects alternate IDs for the same start', () => {
    const result = applyOps(db, [{ opId: 'wrong-id', kind: 'session.complete', payload: {
      journalOnly: true, id: 'alternate', startedAt: now,
    } }], 'phone')
    expect(result.results[0].status).toBe('rejected')
    expect(result.effects).toEqual([])
  })
  it('legacy clients continue to write without guards', () => {
    writeTimerState(db, { phase: 'running', startedAt: String(now), remainingMs: '5000', category: 'other' }, 'build3')
    expect(row()).toMatchObject({ started_at: now, remaining_ms: 5000 })
  })
  it.each([
    { expectedUpdatedAt: undefined }, { expectedStartedAt: undefined }, { recordedAt: undefined },
    { recordedAt: now + 120_000 }, { phase: 'invalid' }, { startedAt: null },
    { targetMs: Infinity }, { targetMs: -1 }, { remainingMs: 1.5 }, { intention: 'x'.repeat(10_001) },
  ])('malformed stronger requests are rejected without changing timer: %j', extra => {
    expect(mirror('invalid', input(extra))).toMatchObject({ status: 'rejected', timerConflict: true })
    expect(row().updated_at).toBe(0)
  })
  it('the direct PUT guard uses the same baseline', () => {
    const body = input()
    validateGuardedTimer(body)
    expect(timerGuardMatches(db, body, 'web')).toBe(true)
    writeTimerState(db, body)
    expect(timerGuardMatches(db, body, 'web')).toBe(false)
  })
})
