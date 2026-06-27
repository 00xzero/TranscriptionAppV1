import { type SessionLock } from './types'

/**
 * In-memory SessionLock fake for unit tests.
 *
 * `ownedElsewhere` simulates sessions a different tab currently owns: for those,
 * `acquire` returns false (claim race lost) and `isHeld` returns true. Sessions
 * this fake acquires are tracked so `release` frees them.
 */
export class FakeSessionLock implements SessionLock {
  private held: string | null = null

  constructor(public readonly ownedElsewhere: Set<string> = new Set()) {}

  async acquire(sessionId: string): Promise<boolean> {
    if (this.ownedElsewhere.has(sessionId)) return false
    if (this.held !== null) return this.held === sessionId
    this.held = sessionId
    return true
  }

  async isHeld(sessionId: string): Promise<boolean> {
    return this.ownedElsewhere.has(sessionId) || this.held === sessionId
  }

  async release(): Promise<void> {
    this.held = null
  }
}
