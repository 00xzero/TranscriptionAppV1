import { recordingLockName, type SessionClaim, type SessionLock } from './types'
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
  private occupied = false

  async acquire(sessionId: string): Promise<SessionClaim | null> {
    if (this.occupied) return null
    this.occupied = true
    if (!(await this.mutex.acquire(recordingLockName(sessionId)))) {
      this.occupied = false
      return null
    }
    let released = false
    return {
      sessionId,
      release: async () => {
        if (released) return
        released = true
        try {
          await this.mutex.release()
        } finally {
          this.occupied = false
        }
      },
    }
  }

  isHeld(sessionId: string): Promise<boolean> {
    return this.mutex.isHeld(recordingLockName(sessionId))
  }

}
