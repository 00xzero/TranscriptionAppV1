import { recordingLockName, type SessionLock } from './types'
import { WebLocksMutex } from './webLocksMutex'

/**
 * Production session lock backed by the Web Locks API.
 *
 * A thin facade over {@link WebLocksMutex} on the per-session lock name. On a
 * query failure it reports `true` (held), matching the recovery probe's
 * conservative ownership policy: unknown liveness must not be treated as a
 * claimable orphan.
 */
export class WebLocksSessionLock implements SessionLock {
  private readonly mutex = new WebLocksMutex({ onQueryFailure: 'held' })

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
