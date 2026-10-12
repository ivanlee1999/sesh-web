/** Durable ordered timer writes. Server receipts make a lost response safe to retry. */
export interface SharedTimerSnapshot {
  updatedAt: number
  startedAt: number | null
  [key: string]: unknown
}
interface PendingTimer {
  opId: string
  deviceId: string
  recordedAt: number
  expectedUpdatedAt?: number
  expectedStartedAt?: number | null
  afterTimerOpId?: string
  [key: string]: unknown
}
interface StoredQueue {
  deviceId: string
  baseline: { updatedAt: number; startedAt: number | null }
  pending: PendingTimer[]
}
const KEY = 'sesh:sharedTimerQueue:v2'
function tabScope(): string {
  // sessionStorage survives reloads, but is distinct for independently opened
  // tabs. One tab's idle polls cannot erase another tab's offline actions.
  try {
    let id = sessionStorage.getItem(`${KEY}:tab`)
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(`${KEY}:tab`, id) }
    return id
  } catch { return crypto.randomUUID() }
}
export class SharedTimerQueue {
  private state: StoredQueue
  private flushing: Promise<void> | null = null
  private generation = 0
  private lastSnapshotVersion = -1
  private ownershipResolved = false
  private scope: string
  private readonly ready: Promise<void>
  onSnapshot?: (snapshot: SharedTimerSnapshot, unchanged: boolean) => void
  onNotice?: (notice: string | null) => void
  onConflict?: () => void
  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
    scope?: string,
    locks: Pick<LockManager, 'request'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks,
  ) {
    this.scope = scope ?? tabScope()
    this.state = { deviceId: crypto.randomUUID(), baseline: { updatedAt: 0, startedAt: null }, pending: [] }
    try {
      const saved = JSON.parse(storage?.getItem(`${KEY}:${this.scope}`) ?? 'null') as StoredQueue | null
      if (saved && typeof saved.deviceId === 'string' && Array.isArray(saved.pending) &&
          Number.isSafeInteger(saved.baseline?.updatedAt)) this.state = saved
    } catch { /* Storage can be unavailable; keep the in-memory queue. */ }
    if (locks) {
      // A duplicated tab inherits sessionStorage. Claim its queue for this
      // document before writing anything; each descendant claims its new key.
      if (this.scope.startsWith('copy:')) this.rotateScope()
      this.ready = new Promise(resolve => {
        const claim = () => {
          void locks.request(`${KEY}:owner:${this.scope}`, { ifAvailable: true }, lock => {
            if (!lock) { this.rotateScope(); claim(); return }
            this.ownershipResolved = true
            this.persist()
            resolve()
            // Browser releases a document's locks when that document closes.
            return new Promise<void>(() => {})
          }).catch(() => {
            // A copy namespace is never trusted as a live ownership claim on
            // a later load, even if that load has a functioning LockManager.
            this.rotateScope(true); this.ownershipResolved = true; this.persist(); resolve()
          })
        }
        claim()
      })
    } else {
      // Older browsers have no live-document lock. Copy into a fresh namespace
      // on every load, retaining receipt IDs but never overwriting another tab.
      if (scope === undefined) this.rotateScope(true)
      this.ownershipResolved = true
      this.ready = Promise.resolve()
      this.persist()
    }
  }
  private rotateScope(fallback = false) {
    this.scope = `${fallback ? 'copy:' : ''}${crypto.randomUUID()}`
    try { sessionStorage.setItem(`${KEY}:tab`, this.scope) } catch {}
  }
  get hasPending(): boolean { return this.state.pending.length > 0 }
  get revision(): number { return this.generation }
  precondition() { return { expectedUpdatedAt: this.state.baseline.updatedAt, expectedStartedAt: this.state.baseline.startedAt } }
  private persist() { if (!this.ownershipResolved) return; try { this.storage?.setItem(`${KEY}:${this.scope}`, JSON.stringify(this.state)) } catch {} }
  accept(snapshot: SharedTimerSnapshot) {
    if (this.hasPending) return
    if (!Number.isSafeInteger(snapshot.updatedAt) || snapshot.updatedAt < this.state.baseline.updatedAt) return
    const unchanged = snapshot.updatedAt === this.lastSnapshotVersion
    this.state.baseline = { updatedAt: snapshot.updatedAt, startedAt: snapshot.startedAt }
    this.lastSnapshotVersion = snapshot.updatedAt
    this.persist()
    this.onSnapshot?.(snapshot, unchanged)
  }
  enqueue(body: Record<string, unknown>): Promise<void> {
    const previous = this.state.pending.at(-1)
    this.state.pending.push({ ...body, opId: crypto.randomUUID(), deviceId: this.state.deviceId,
      recordedAt: Date.now(), ...(previous ? { afterTimerOpId: previous.opId } : {
        expectedUpdatedAt: this.state.baseline.updatedAt, expectedStartedAt: this.state.baseline.startedAt,
      }) })
    this.generation += 1
    this.persist()
    this.onNotice?.('Syncing session…')
    return this.flush()
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing
    this.flushing = this.send().finally(() => { this.flushing = null })
    return this.flushing
  }
  private async send(): Promise<void> {
    await this.ready
    while (this.state.pending.length) {
      const op = this.state.pending[0]
      try {
        const response = await fetch('/api/timer', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op) })
        const data = await response.json()
        if (response.status === 409 || response.status === 400) {
          // All following operations depend on this one. None may overwrite the winner.
          this.onConflict?.()
          this.state.pending = []
          this.persist()
          if (data.timer) this.accept(data.timer)
          this.onNotice?.('Session changed on another device. Showing the latest timer; your reflection notes are kept.')
          return
        }
        if (!response.ok || data.result && !['applied', 'duplicate'].includes(data.result.status))
          throw new Error('Timer sync unavailable')
        this.state.pending.shift()
        this.state.baseline = { updatedAt: data.updatedAt, startedAt: data.startedAt }
        this.persist()
        if (!this.hasPending) {
          this.accept(data)
          this.onNotice?.(null)
        }
      } catch {
        // Keep exact op identity, timing and dependencies for reconnect/relaunch.
        this.onNotice?.('Offline — session changes will sync when connected.')
        return
      }
    }
  }
}
