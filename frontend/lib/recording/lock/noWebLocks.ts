import type { SessionPersistence } from '../persistence'
import type { SessionLock } from './types'

/** Owner is presumed alive while chunks/timestamps are this fresh. */
export const OWNER_STALE_MS = 30_000

/**
 * Degraded fallback for browsers without the Web Locks API.
 *
 * Without locks there is no real cross-tab coordination, so `acquire` always
 * succeeds and `isHeld` approximates ownership from chunk freshness: a session
 * whose last chunk arrived within `OWNER_STALE_MS` is treated as still owned.
 * This is interim, best-effort only — the full degraded presence/heartbeat path
 * is Phase 4. Web Locks is broadly supported (Chrome, Safari 15.4+), so this
 * path is rarely taken.
 */
export class NoWebLocksSessionLock implements SessionLock {
  constructor(
    private readonly persistence: SessionPersistence,
    private readonly staleMs: number = OWNER_STALE_MS,
    private readonly now: () => number = () => Date.now()
  ) {}

  async acquire(_sessionId: string): Promise<boolean> {
    return true
  }

  async isHeld(sessionId: string): Promise<boolean> {
    try {
      const row = await this.persistence.getSession(sessionId)
      if (!row) return false
      const last = row.lastChunkReceivedAt ?? row.startedAt ?? row.createdAt
      return this.now() - last < this.staleMs
    } catch {
      return false
    }
  }

  async release(): Promise<void> {
    // No real lock to release.
  }
}
