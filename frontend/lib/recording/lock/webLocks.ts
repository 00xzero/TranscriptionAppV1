import { recordingLockName, type SessionLock } from './types'

/**
 * Production adapter backed by the Web Locks API.
 *
 * `acquire` requests an exclusive lock with `ifAvailable: true`, so it resolves
 * to `false` immediately when the lock is already held instead of queueing — the
 * property that lets recovery claim an orphan race-free. On success the lock is
 * held for the session lifetime via a promise that only settles when `release`
 * is called (or the tab dies, which the browser handles automatically).
 */
export class WebLocksSessionLock implements SessionLock {
  private releaseFn: (() => void) | null = null
  private heldName: string | null = null

  async acquire(sessionId: string): Promise<boolean> {
    const name = recordingLockName(sessionId)
    if (this.releaseFn) {
      // Invariant: a holder owns at most one session lock at a time. If we're
      // already holding, only report success when it's the same session.
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

  async isHeld(sessionId: string): Promise<boolean> {
    try {
      const snapshot = await navigator.locks.query()
      const name = recordingLockName(sessionId)
      return (snapshot.held ?? []).some((lock) => lock.name === name)
    } catch {
      return false
    }
  }

  async release(): Promise<void> {
    this.releaseFn?.()
  }
}
