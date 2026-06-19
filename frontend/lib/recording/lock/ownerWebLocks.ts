import { OWNER_LOCK_NAME, type BrowserOwnerLock } from './ownerTypes'

/**
 * Production owner mutex backed by the Web Locks API.
 *
 * Mirrors `WebLocksSessionLock` but on the fixed `OWNER_LOCK_NAME`. `acquire`
 * uses `ifAvailable: true` so it resolves `false` immediately when another tab
 * already owns the lock instead of queueing — the property that makes
 * duplicate-start blocking race-free. The lock is held open until `release`.
 */
export class WebLocksOwnerLock implements BrowserOwnerLock {
  private releaseFn: (() => void) | null = null

  async acquire(): Promise<boolean> {
    if (this.releaseFn) return true

    return new Promise<boolean>((resolveAcquired) => {
      try {
        navigator.locks
          .request(OWNER_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, (lock) => {
            if (!lock) {
              resolveAcquired(false)
              return undefined
            }
            return new Promise<void>((resolveHeld) => {
              this.releaseFn = () => {
                this.releaseFn = null
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

  async isHeld(): Promise<boolean> {
    try {
      const snapshot = await navigator.locks.query()
      return (snapshot.held ?? []).some((lock) => lock.name === OWNER_LOCK_NAME)
    } catch {
      // Be conservative: a query failure must not be interpreted as "free",
      // because stale presence + free lock is what triggers owner-loss recovery.
      return true
    }
  }

  async release(): Promise<void> {
    this.releaseFn?.()
  }
}
