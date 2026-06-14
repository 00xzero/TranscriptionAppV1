import type { SessionPersistence } from './types'

/** Sessions older than this are swept regardless of state. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Best-effort garbage collection: delete session rows (and their chunks) older
 * than `maxAgeMs`. Returns the number of sessions deleted. Swallows errors so a
 * failed sweep never propagates into recording start.
 */
export async function gcExpiredSessions(
  persistence: SessionPersistence,
  now: number = Date.now(),
  maxAgeMs: number = SESSION_MAX_AGE_MS
): Promise<number> {
  let deleted = 0
  try {
    const sessions = await persistence.listSessions()
    for (const session of sessions) {
      if (now - session.createdAt >= maxAgeMs) {
        await persistence.deleteSession(session.sessionId)
        deleted++
      }
    }
  } catch {
    // GC is advisory; never let it surface.
  }
  return deleted
}
