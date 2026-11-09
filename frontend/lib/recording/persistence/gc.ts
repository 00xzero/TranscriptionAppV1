import type { SessionLock } from '../lock/types'
import type { PersistedSession, SessionPersistence } from './types'

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** Sweep parsed rows without disturbing another tab's recording or recovery. */
export async function sweepExpiredSessions(
  persistence: SessionPersistence,
  lock: SessionLock,
  rows: PersistedSession[],
  now: number = Date.now(),
  canProceed: () => boolean = () => true
): Promise<{ deleted: number; survivors: PersistedSession[] }> {
  let deleted = 0
  const survivors: PersistedSession[] = []
  for (const row of rows) {
    if (!canProceed()) break
    if (now - row.createdAt < SESSION_MAX_AGE_MS) {
      survivors.push(row)
      continue
    }
    try {
      if (await lock.isHeld(row.sessionId) || !canProceed()) continue
      const claim = await lock.acquire(row.sessionId)
      if (!claim) continue
      try {
        const current = await persistence.getSession(row.sessionId)
        if (canProceed() && current && now - current.createdAt >= SESSION_MAX_AGE_MS) {
          await persistence.deleteSession(row.sessionId)
          deleted++
        }
      } finally {
        await claim.release()
      }
    } catch {
      // Best effort. A failed sweep can be retried by a later probe.
    }
  }
  return { deleted, survivors }
}
