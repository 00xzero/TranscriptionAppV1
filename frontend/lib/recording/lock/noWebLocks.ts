import type { SessionPersistence } from '../persistence'
import type { SessionClaim, SessionLock } from './types'

/** Owner is presumed alive while chunks/timestamps are this fresh. */
export const OWNER_STALE_MS = 30_000

/**
 * Degraded fallback for browsers without the Web Locks API.
 *
 * Claims are exclusive within this tab. Across tabs, `isHeld` approximates
 * ownership from chunk freshness: a session
 * whose last chunk arrived within `OWNER_STALE_MS` is treated as still owned.
 * This is interim, best-effort only — the full degraded presence/heartbeat path
 * is Phase 4. Web Locks is broadly supported (Chrome, Safari 15.4+), so this
 * path is rarely taken.
 */
export class NoWebLocksSessionLock implements SessionLock {
  private claim: SessionClaim | null = null

  constructor(
    private readonly persistence: SessionPersistence,
    private readonly staleMs: number = OWNER_STALE_MS,
    private readonly now: () => number = () => Date.now()
  ) {}

  async acquire(sessionId: string): Promise<SessionClaim | null> {
    if (this.claim) return null
    const claim = {
      sessionId,
      release: async () => {
        if (this.claim === claim) this.claim = null
      },
    }
    this.claim = claim
    return claim
  }

  async isHeld(sessionId: string): Promise<boolean> {
    if (this.claim?.sessionId === sessionId) return true
    try {
      const row = await this.persistence.getSession(sessionId)
      if (!row) return false
      const last = row.lastChunkReceivedAt ?? row.startedAt ?? row.createdAt
      return this.now() - last < this.staleMs
    } catch {
      return false
    }
  }
}
