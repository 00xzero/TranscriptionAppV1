import type { PersistedSession, SessionPersistence } from './types'

/** Sessions older than this are swept regardless of state. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface GcSweepResult {
  /** Number of sessions deleted by the sweep. */
  deleted: number
  /** Rows younger than `maxAgeMs` — i.e. those that survived the sweep. */
  survivors: PersistedSession[]
}

/**
 * Best-effort sweep over *pre-fetched* session rows: delete those older than
 * `maxAgeMs` (along with their chunks) and return the survivors. Lets a caller
 * that already holds the row list (e.g. the recovery probe) reuse it instead of
 * issuing a second full `listSessions()` + parse pass. Per-row deletes are
 * best-effort; a failed delete keeps the row as a survivor rather than aborting.
 */
export async function sweepExpiredSessions(
  persistence: SessionPersistence,
  rows: PersistedSession[],
  now: number = Date.now(),
  maxAgeMs: number = SESSION_MAX_AGE_MS
): Promise<GcSweepResult> {
  let deleted = 0
  const survivors: PersistedSession[] = []
  for (const session of rows) {
    if (now - session.createdAt < maxAgeMs) {
      survivors.push(session)
      continue
    }
    try {
      await persistence.deleteSession(session.sessionId)
      deleted++
    } catch {
      // Advisory GC — a failed delete shouldn't abort the sweep.
      survivors.push(session)
    }
  }
  return { deleted, survivors }
}

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
  try {
    const sessions = await persistence.listSessions()
    const { deleted } = await sweepExpiredSessions(persistence, sessions, now, maxAgeMs)
    return deleted
  } catch {
    // GC is advisory; never let it surface.
    return 0
  }
}
