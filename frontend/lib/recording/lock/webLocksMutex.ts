/** What `isHeld()` reports when `navigator.locks.query()` throws. */
export type QueryFailurePolicy = 'held' | 'free'

/**
 * Shared Web Locks plumbing for the recording locks.
 *
 * Both recording locks (`WebLocksSessionLock`, per session; `WebLocksOwnerLock`,
 * the single per-browser owner mutex) are the same `navigator.locks` hold-open
 * pattern over a different name, so the fragile mechanics live here once and the
 * facades just pass their name.
 *
 * `acquire` requests an exclusive lock with `ifAvailable: true`, so it resolves
 * `false` immediately when the lock is already held instead of queueing — the
 * property that lets a duplicate-start (owner) or recovery-claim (session) lose
 * the race without blocking. On success the lock is held for the holder's
 * lifetime via a promise that only settles when `release` is called (or the tab
 * dies, which the browser handles automatically).
 *
 * A holder owns at most one lock at a time: re-acquiring while held returns true
 * only for the same name. The session lock relies on this to enforce its
 * one-session invariant; the owner lock always passes its fixed name, so the
 * same check reproduces its "already mine → true" behaviour exactly.
 */
export class WebLocksMutex {
  private releaseFn: (() => void) | null = null
  private heldName: string | null = null

  constructor(private readonly opts: { onQueryFailure: QueryFailurePolicy }) {}

  async acquire(name: string): Promise<boolean> {
    if (this.releaseFn) {
      // Already holding: only report success when it's the same name.
      return this.heldName === name
    }

    return new Promise<boolean>((resolveAcquired) => {
      try {
        navigator.locks
          .request(name, { mode: 'exclusive', ifAvailable: true }, (lock) => {
            if (!lock) {
              resolveAcquired(false)
              return undefined
            }
            this.heldName = name
            // Hold the lock open until release() resolves this inner promise.
            return new Promise<void>((resolveHeld) => {
              this.releaseFn = () => {
                this.releaseFn = null
                this.heldName = null
                resolveHeld()
              }
              resolveAcquired(true)
            })
          })
          .catch(() => resolveAcquired(false))
      } catch {
        resolveAcquired(false)
      }
    })
  }

  async isHeld(name: string): Promise<boolean> {
    try {
      const snapshot = await navigator.locks.query()
      return (snapshot.held ?? []).some((lock) => lock.name === name)
    } catch {
      return this.opts.onQueryFailure === 'held'
    }
  }

  async release(): Promise<void> {
    this.releaseFn?.()
  }
}
