import { recordingLockName, type SessionLock } from './types'
import { WebLocksMutex } from './webLocksMutex'

/**
 * Production session lock backed by the Web Locks API.
 *
 * A thin facade over {@link WebLocksMutex} on the per-session lock name. On a
 * query failure it reports `false` (not held), preserving the original fail-open
 * behavior — the opposite of the owner lock's conservative `'held'`. The session
 * lock is only a best-effort pre-filter for the recovery owner-check (which may
 * validate, surface, or delete a probed session), so this less-conservative
 * choice is the historically-accepted tradeoff, not a safety guarantee.
 */
export class WebLocksSessionLock implements SessionLock {
  private readonly mutex = new WebLocksMutex({ onQueryFailure: 'free' })

  acquire(sessionId: string): Promise<boolean> {
    return this.mutex.acquire(recordingLockName(sessionId))
  }

  isHeld(sessionId: string): Promise<boolean> {
    return this.mutex.isHeld(recordingLockName(sessionId))
  }

  release(): Promise<void> {
    return this.mutex.release()
  }
}
