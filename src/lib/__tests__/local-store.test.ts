import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveTimerState,
  loadTimerState,
  clearTimerState,
  enqueueSession,
  getSessionQueue,
  clearSessionQueue,
  removeQueuedSession,
  cacheCategories,
  getCachedCategories,
  type LocalTimerState,
  type QueuedSession,
} from '../local-store'

beforeEach(() => {
  localStorage.clear()
})

// ── Timer state ─────────────────────────────────────────────────────────

describe('saveTimerState / loadTimerState', () => {
  const baseState: LocalTimerState = {
    phase: 'running',
    sessionType: 'focus',
    intention: 'Write tests',
    category: 'deep-work',
    targetMs: 1500000,
    remainingMs: 900000,
    overflowMs: 0,
    startedAt: 1700000000000,
    pausedAt: null,
    todoistTaskId: null,
    savedAt: 0,
  }

  it('round-trips data correctly', () => {
    saveTimerState(baseState)
    const loaded = loadTimerState()
    expect(loaded).not.toBeNull()
    expect(loaded!.phase).toBe('running')
    expect(loaded!.sessionType).toBe('focus')
    expect(loaded!.intention).toBe('Write tests')
    expect(loaded!.category).toBe('deep-work')
    expect(loaded!.targetMs).toBe(1500000)
    expect(loaded!.remainingMs).toBe(900000)
    expect(loaded!.overflowMs).toBe(0)
    expect(loaded!.startedAt).toBe(1700000000000)
    expect(loaded!.pausedAt).toBeNull()
    expect(loaded!.todoistTaskId).toBeNull()
  })

  it('sets savedAt to current timestamp on save', () => {
    const before = Date.now()
    saveTimerState(baseState)
    const loaded = loadTimerState()
    expect(loaded!.savedAt).toBeGreaterThanOrEqual(before)
    expect(loaded!.savedAt).toBeLessThanOrEqual(Date.now())
  })

  it('returns null when localStorage is empty', () => {
    expect(loadTimerState()).toBeNull()
  })

  it('returns null when localStorage has invalid JSON', () => {
    localStorage.setItem('sesh:timer', '{invalid')
    expect(loadTimerState()).toBeNull()
  })
})

describe('loadTimerState — NaN coercion prevention', () => {
  it('coerces string numbers to actual numbers for targetMs/remainingMs/overflowMs', () => {
    // Simulate what might happen if a buggy client wrote strings
    localStorage.setItem('sesh:timer', JSON.stringify({
      phase: 'running',
      sessionType: 'focus',
      intention: '',
      category: 'deep-work',
      targetMs: '1500000',
      remainingMs: '900000',
      overflowMs: '0',
      startedAt: 1700000000000,
      pausedAt: null,
      todoistTaskId: null,
      savedAt: Date.now(),
    }))
    const loaded = loadTimerState()
    // String "1500000" should be coerced to 1500000, not lost as 0
    expect(loaded!.targetMs).toBe(1500000)
    expect(loaded!.remainingMs).toBe(900000)
    expect(loaded!.overflowMs).toBe(0)
  })

  it('coerces NaN/Infinity to 0', () => {
    localStorage.setItem('sesh:timer', JSON.stringify({
      phase: 'idle',
      sessionType: 'focus',
      intention: '',
      category: 'other',
      targetMs: NaN,
      remainingMs: Infinity,
      overflowMs: -Infinity,
      startedAt: null,
      pausedAt: null,
      todoistTaskId: null,
      savedAt: Date.now(),
    }))
    const loaded = loadTimerState()
    // JSON.stringify converts NaN/Infinity to null, then Number.isFinite(null) = false → 0
    expect(loaded!.targetMs).toBe(0)
    expect(loaded!.remainingMs).toBe(0)
    expect(loaded!.overflowMs).toBe(0)
  })

  it('handles ISO-string startedAt from legacy state', () => {
    const isoDate = '2024-01-15T10:30:00.000Z'
    const expectedMs = Date.parse(isoDate)
    localStorage.setItem('sesh:timer', JSON.stringify({
      phase: 'running',
      sessionType: 'focus',
      intention: '',
      category: 'deep-work',
      targetMs: 1500000,
      remainingMs: 900000,
      overflowMs: 0,
      startedAt: isoDate,
      pausedAt: null,
      todoistTaskId: null,
      savedAt: Date.now(),
    }))
    const loaded = loadTimerState()
    expect(loaded!.startedAt).toBe(expectedMs)
  })

  it('handles numeric-string startedAt', () => {
    localStorage.setItem('sesh:timer', JSON.stringify({
      phase: 'running',
      sessionType: 'focus',
      intention: '',
      category: 'deep-work',
      targetMs: 1500000,
      remainingMs: 900000,
      overflowMs: 0,
      startedAt: '1700000000000',
      pausedAt: null,
      todoistTaskId: null,
      savedAt: Date.now(),
    }))
    const loaded = loadTimerState()
    expect(loaded!.startedAt).toBe(1700000000000)
  })

  it('sets unparseable startedAt to null', () => {
    localStorage.setItem('sesh:timer', JSON.stringify({
      phase: 'running',
      sessionType: 'focus',
      intention: '',
      category: 'deep-work',
      targetMs: 1500000,
      remainingMs: 900000,
      overflowMs: 0,
      startedAt: 'not-a-date',
      pausedAt: null,
      todoistTaskId: null,
      savedAt: Date.now(),
    }))
    const loaded = loadTimerState()
    expect(loaded!.startedAt).toBeNull()
  })
})

describe('clearTimerState', () => {
  it('removes timer from localStorage', () => {
    saveTimerState({
      phase: 'idle', sessionType: 'focus', intention: '', category: 'other',
      targetMs: 0, remainingMs: 0, overflowMs: 0, startedAt: null,
      pausedAt: null, todoistTaskId: null, savedAt: 0,
    })
    clearTimerState()
    expect(loadTimerState()).toBeNull()
  })
})

// ── Session queue ───────────────────────────────────────────────────────

describe('session queue operations', () => {
  const session: QueuedSession = {
    id: 'test-1',
    intention: 'Code review',
    category: 'deep-work',
    type: 'focus',
    targetMs: 1500000,
    actualMs: 1600000,
    overflowMs: 100000,
    startedAt: 1700000000000,
    endedAt: 1700001600000,
    notes: '',
    todoistTaskId: null,
    queuedAt: Date.now(),
  }

  it('returns empty array when no sessions queued', () => {
    expect(getSessionQueue()).toEqual([])
  })

  it('enqueues and retrieves sessions', () => {
    enqueueSession(session)
    const queue = getSessionQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].id).toBe('test-1')
    expect(queue[0].intention).toBe('Code review')
  })

  it('enqueues multiple sessions in order', () => {
    enqueueSession({ ...session, id: 'a' })
    enqueueSession({ ...session, id: 'b' })
    enqueueSession({ ...session, id: 'c' })
    const queue = getSessionQueue()
    expect(queue).toHaveLength(3)
    expect(queue.map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('removeQueuedSession removes by index', () => {
    enqueueSession({ ...session, id: 'a' })
    enqueueSession({ ...session, id: 'b' })
    enqueueSession({ ...session, id: 'c' })
    removeQueuedSession(1) // remove 'b'
    const queue = getSessionQueue()
    expect(queue).toHaveLength(2)
    expect(queue.map(s => s.id)).toEqual(['a', 'c'])
  })

  it('clearSessionQueue removes all sessions', () => {
    enqueueSession(session)
    enqueueSession({ ...session, id: 'test-2' })
    clearSessionQueue()
    expect(getSessionQueue()).toEqual([])
  })
})

// ── Categories cache ────────────────────────────────────────────────────

describe('category caching', () => {
  it('returns null when no categories cached', () => {
    expect(getCachedCategories()).toBeNull()
  })

  it('caches and retrieves categories', () => {
    const cats = [
      { id: '1', name: 'deep-work', label: 'Deep Work', color: '#3b82f6', sortOrder: 0, isDefault: true },
      { id: '2', name: 'reading', label: 'Reading', color: '#10b981', sortOrder: 1, isDefault: false },
    ]
    cacheCategories(cats)
    const cached = getCachedCategories()
    expect(cached).toEqual(cats)
  })

  it('overwrites previous cache', () => {
    cacheCategories([{ id: '1', name: 'old' }])
    cacheCategories([{ id: '2', name: 'new' }])
    const cached = getCachedCategories()
    expect(cached).toHaveLength(1)
    expect(cached![0].name).toBe('new')
  })

  it('returns null for corrupted cache', () => {
    localStorage.setItem('sesh:categories', '{not-json')
    expect(getCachedCategories()).toBeNull()
  })
})
