import type { SessionClaim, SessionLock } from './types'

/**
 * In-memory SessionLock fake for unit tests.
 *
 * `ownedElsewhere` simulates sessions a different tab currently owns: for those,
 * `acquire` returns null (claim race lost) and `isHeld` returns true.
 */
export class FakeSessionLock implements SessionLock {
  private held: SessionClaim | null = null

  constructor(public readonly ownedElsewhere: Set<string> = new Set()) {}

  async acquire(sessionId: string): Promise<SessionClaim | null> {
    if (this.ownedElsewhere.has(sessionId) || this.held) return null
    const claim = {
      sessionId,
      release: async () => {
        if (this.held === claim) this.held = null
      },
    }
    this.held = claim
    return claim
  }

  async isHeld(sessionId: string): Promise<boolean> {
    return this.ownedElsewhere.has(sessionId) || this.held?.sessionId === sessionId
  }

}
