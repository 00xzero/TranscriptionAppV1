import { OWNER_LOCK_NAME, type BrowserOwnerLock } from './ownerTypes'
import { WebLocksMutex } from './webLocksMutex'

/**
 * Production owner mutex backed by the Web Locks API.
 *
 * A thin facade over {@link WebLocksMutex} on the fixed `OWNER_LOCK_NAME`. On a
 * query failure it reports `true` (held) — be conservative: a query failure must
 * not be read as "no owner", because stale presence + a free lock is exactly what
 * triggers owner-loss recovery.
 */
export class WebLocksOwnerLock implements BrowserOwnerLock {
  private readonly mutex = new WebLocksMutex({ onQueryFailure: 'held' })

  acquire(): Promise<boolean> {
    return this.mutex.acquire(OWNER_LOCK_NAME)
  }

  isHeld(): Promise<boolean> {
    return this.mutex.isHeld(OWNER_LOCK_NAME)
  }

  release(): Promise<void> {
    return this.mutex.release()
  }
}
