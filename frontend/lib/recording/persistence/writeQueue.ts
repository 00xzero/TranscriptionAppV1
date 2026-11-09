import type {
  PersistedSession,
  PersistedSessionPatch,
  SessionPersistence,
} from './types'

type QueueOp =
  | { kind: 'session'; record: PersistedSession }
  | { kind: 'chunk'; seq: number; blob: Blob }
  | { kind: 'metadata'; patch: PersistedSessionPatch }
  | { kind: 'delete'; canDelete?: () => boolean }

/**
 * Write-behind persistence for a single recording session.
 *
 * Enqueue methods return synchronously and never block the recorder hot path.
 * Operations drain serially in FIFO order so chunk seq order is preserved and
 * metadata never races.
 *
 * Invariants:
 * - `putSession` is the first persistence op for a session. Chunk/metadata ops
 *   received before the session is enqueued are buffered and ordered after it.
 * - Any write failure triggers a sticky downgrade (`armed = false`): a single
 *   best-effort marker write, then all further persistence stops. The failure is
 *   never re-raised — live recording continues regardless.
 * - Terminal teardown goes through `closeAndDelete()` so deletion is ordered after
 *   in-flight writes and a late `dataavailable` cannot resurrect rows.
 */
export class SessionWriteQueue {
  private ops: QueueOp[] = []
  private draining = false
  private accepting = true
  private closing = false
  private armed = true
  private sessionEnqueued = false
  private failureReason: string | null = null
  private settleWaiters: Array<() => void> = []

  constructor(
    private readonly persistence: SessionPersistence,
    private readonly sessionId: string,
    /**
     * Fired once when the session downgrades to `armed = false` (first write
     * failure or a lazy IndexedDB open that throws on the first op). Lets the live
     * session surface the unarmed warning. Never fired for the unavailable-from-
     * start case — that is detected up front via `SessionPersistence.durable`.
     */
    private readonly onDowngrade?: (
      sessionId: string,
      reason: string | null
    ) => void
  ) {}

  isArmed(): boolean {
    return this.armed
  }

  getFailureReason(): string | null {
    return this.failureReason
  }

  enqueueSession(record: PersistedSession): void {
    if (!this.accepting || !this.armed) return
    // putSession must be the first persistence op: place it ahead of any
    // chunk/metadata ops buffered before the session existed.
    this.ops.unshift({ kind: 'session', record })
    this.sessionEnqueued = true
    this.kick()
  }

  enqueueChunk(seq: number, blob: Blob): void {
    if (!this.accepting || !this.armed) return
    this.ops.push({ kind: 'chunk', seq, blob })
    this.kick()
  }

  enqueueMetadata(patch: PersistedSessionPatch): void {
    if (!this.accepting || !this.armed) return
    // Coalesce consecutive metadata patches that have not drained yet.
    const last = this.ops[this.ops.length - 1]
    if (last && last.kind === 'metadata') {
      last.patch = { ...last.patch, ...patch }
    } else {
      this.ops.push({ kind: 'metadata', patch })
    }
    this.kick()
  }

  /**
   * Stop accepting writes and settle deletion. A guarded delete drains pending
   * writes first so the session stays recoverable if deletion is refused.
   */
  async closeAndDelete(canDelete?: () => boolean): Promise<void> {
    this.accepting = false
    this.closing = true
    const deletion = { kind: 'delete', canDelete } as const
    // A guarded discard may be refused after the account switches. Drain its
    // pending writes so the original account can still recover that audio.
    this.ops = canDelete ? [...this.ops, deletion] : [deletion]
    this.kick()
    await this.whenSettled()
  }

  /** Stop accepting writes and drain without deleting the recovery copy. */
  async seal(): Promise<void> {
    this.accepting = false
    await this.whenSettled()
  }

  /** Resolves when the queue has fully drained (no pending or in-flight ops). */
  whenSettled(): Promise<void> {
    if (!this.draining && this.ops.length === 0) return Promise.resolve()
    return new Promise((resolve) => {
      this.settleWaiters.push(resolve)
    })
  }

  private kick(): void {
    // Gate draining until the session op exists, except during terminal teardown.
    if (!this.sessionEnqueued && !this.closing) return
    if (this.draining) return
    this.draining = true
    void this.runLoop()
  }

  private async runLoop(): Promise<void> {
    try {
      // Let synchronous enqueues batch before the first write of this pass.
      await Promise.resolve()
      while (this.ops.length > 0) {
        const op = this.ops.shift() as QueueOp
        try {
          await this.run(op)
        } catch (err) {
          await this.handleFailure(op, err)
        }
      }
    } finally {
      this.draining = false
    }

    if (this.ops.length > 0) {
      this.kick()
    } else {
      this.flushSettleWaiters()
    }
  }

  private run(op: QueueOp): Promise<void> {
    switch (op.kind) {
      case 'session':
        return this.persistence.putSession(op.record)
      case 'chunk':
        return this.persistence.putChunk(this.sessionId, op.seq, op.blob)
      case 'metadata':
        return this.persistence.patchSession(this.sessionId, op.patch)
      case 'delete':
        return op.canDelete
          ? this.persistence.deleteSession(this.sessionId, op.canDelete)
          : this.persistence.deleteSession(this.sessionId)
    }
  }

  private async handleFailure(op: QueueOp, err: unknown): Promise<void> {
    if (op.kind === 'delete') {
      // Terminal delete failed; leave residue for GC. Never recurse.
      return
    }
    if (!this.armed) return

    this.armed = false
    this.failureReason = err instanceof Error ? err.message : String(err)
    // Surface the downgrade to the live session (unarmed warning). Swallow any
    // observer error so persistence failure handling never throws.
    try {
      this.onDowngrade?.(this.sessionId, this.failureReason)
    } catch {
      // ignore — best-effort notification
    }
    // Sticky downgrade: drop pending work, but keep a queued terminal delete.
    this.ops = this.ops.filter((pending) => pending.kind === 'delete')
    // Single best-effort downgrade marker; swallow its own failure, no recursion.
    await this.persistence
      .patchSession(this.sessionId, {
        armed: false,
        failureReason: this.failureReason,
      })
      .catch(() => {})
  }

  private flushSettleWaiters(): void {
    if (this.draining || this.ops.length > 0) return
    const waiters = this.settleWaiters
    this.settleWaiters = []
    for (const resolve of waiters) resolve()
  }
}
