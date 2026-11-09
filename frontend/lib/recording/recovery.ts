/**
 * Recovery probe.
 *
 * Scans IndexedDB for an orphaned recording session belonging to the current
 * user and returns the newest one it can *claim* and recover. The chunk stream
 * is authoritative: a candidate is recoverable only if it passes structural
 * validation, meets the bytes floor, has a usable codec, is not owned by a live
 * tab, and can be claimed via the session lock (so two tabs can't both recover
 * the same session). Below-floor / structurally-invalid orphans are silently
 * deleted; sessions owned/claimed elsewhere are left alone.
 */

import {
  meetsRecoveryFloor,
  SESSION_MAX_AGE_MS,
  sweepExpiredSessions,
  validateChunkStream,
  type PersistedSession,
  type SessionPersistence,
} from './persistence'
import type { SessionClaim, SessionLock } from './lock'
import { getPresence, type RecordingPresence } from './presence'
import type { RecoverableInfo } from './sessionTypes'
import { hasConfirmedHandoffInPage } from './confirmedHandoff'

export interface RecoveryProbeResult {
  info: RecoverableInfo
  claim: SessionClaim
}

/** Resolve a MIME usable for assembling the recovered File, or null. */
function codecMimeFor(row: PersistedSession): string | null {
  if (row.codecMime) return row.codecMime
  if (row.codecExtension === 'webm') return 'audio/webm'
  if (row.codecExtension === 'mp4') return 'audio/mp4'
  return null
}

/**
 * How much captured-but-unpersisted audio (ms) at the tail is enough to warn the
 * user that a recovered recording may be missing its end.
 */
export const TRUNCATION_THRESHOLD_MS = 30_000

/**
 * Decide whether a recovered session likely lost a meaningful tail.
 *
 * Preferred signal: the presence snapshot (localStorage, independent of the IDB
 * write queue) records `lastChunkReceivedAt` for the last chunk the live recorder
 * *received*, which keeps advancing past a persistence downgrade. The persisted
 * row's `lastChunkReceivedAt` freezes at the last *durable* chunk, so their
 * difference is the dropped tail in audio time — pause- and upload-proof (unlike
 * `heartbeatAt`, which advances on wall-clock through pauses/uploads).
 *
 * Fallback when no matching snapshot survived (private mode, a soft interruption
 * cleared it, or a newer session overwrote it): the durability downgrade flag is the
 * only remaining hint that persistence stopped before the recording ended.
 */
export function assessTruncation(
  row: PersistedSession,
  presence: RecordingPresence | null,
  thresholdMs: number = TRUNCATION_THRESHOLD_MS
): boolean {
  // An interrupted upload has a complete capture; only a capturing-phase orphan can
  // be tail-truncated.
  if (row.phase !== 'capturing') return false

  if (
    presence?.sessionId === row.sessionId &&
    presence.lastChunkReceivedAt != null &&
    row.lastChunkReceivedAt != null
  ) {
    return presence.lastChunkReceivedAt - row.lastChunkReceivedAt > thresholdMs
  }

  return row.armed === false
}

// Null means invalid. Read failures are handled by the probe and leave the row alone.
async function inspectAudio(
  persistence: SessionPersistence,
  row: PersistedSession
): Promise<{ mime: string; bytes: number } | null> {
  const seqs = await persistence.listChunkSeqs(row.sessionId)
  const mime = codecMimeFor(row)
  if (!mime || !validateChunkStream(seqs).valid) return null
  const { count, totalBytes } = await persistence.chunkStats(row.sessionId)
  return count === seqs.length && meetsRecoveryFloor(totalBytes)
    ? { mime, bytes: totalBytes }
    : null
}

export async function probeRecoverableSessions(
  persistence: SessionPersistence,
  lock: SessionLock,
  userId: string,
  now: number = Date.now(),
  excludeSessionId: string | null = null,
  readPresence: () => RecordingPresence | null = () => getPresence().read(),
  canProceed: () => boolean = () => true
): Promise<RecoveryProbeResult | null> {
  let rows: PersistedSession[]
  try {
    const listed = await persistence.listSessions()
    rows = (await sweepExpiredSessions(persistence, lock, listed, now, canProceed)).survivors
  } catch {
    return null
  }

  const candidates = rows
    .filter((row) => row.userId === userId && row.sessionId !== excludeSessionId)
    .sort((a, b) => b.createdAt - a.createdAt)
  const valid: string[] = []
  const isEligible = (row: PersistedSession | null): row is PersistedSession =>
    row !== null && row.userId === userId && now - row.createdAt < SESSION_MAX_AGE_MS
  const cleanupOnly = (row: PersistedSession) =>
    Boolean(row.cleanupOnly) || hasConfirmedHandoffInPage(row.sessionId, userId)

  // Finish destructive cleanup before taking the modal claim. The adapter can
  // hold only one claim, and an unavailable claim leaves the row for later.
  for (const row of candidates) {
    if (!canProceed()) return null
    try {
      if (await lock.isHeld(row.sessionId) || !canProceed()) continue
      if (!cleanupOnly(row) && await inspectAudio(persistence, row)) {
        valid.push(row.sessionId)
        continue
      }
      if (!canProceed()) return null
      const claim = await lock.acquire(row.sessionId)
      if (!claim) continue
      try {
        const current = await persistence.getSession(row.sessionId)
        if (canProceed() && isEligible(current) &&
          (cleanupOnly(current) || !(await inspectAudio(persistence, current))) && canProceed()) {
          await persistence.deleteSession(row.sessionId)
        }
      } finally {
        await claim.release()
      }
    } catch {
      // Failed reads and unavailable rows can be retried by a later probe.
    }
  }

  let presence: RecordingPresence | null = null
  try {
    presence = readPresence()
  } catch {
    // Truncation assessment falls back to persisted metadata.
  }

  for (const [index, sessionId] of valid.entries()) {
    if (!canProceed()) return null
    let claim: SessionClaim | null = null
    let keepClaim = false
    try {
      claim = await lock.acquire(sessionId)
      if (!claim || !canProceed()) continue
      const row = await persistence.getSession(sessionId)
      if (!isEligible(row) || cleanupOnly(row) || !canProceed()) continue
      const audio = await inspectAudio(persistence, row)
      if (!audio || !canProceed()) continue
      keepClaim = true
      return {
        claim,
        info: {
          sessionId,
          uploadIntentId: row.uploadIntentId,
          projectId: row.projectId,
          title: row.title,
          generatedTitle: row.generatedTitle,
          keyTerms: row.keyTerms,
          transcriptionOptions: row.transcriptionOptions,
          codecMime: audio.mime,
          codecExtension: row.codecExtension,
          bytesSoFar: audio.bytes,
          createdAt: row.createdAt,
          remainingCount: valid.length - index - 1,
          mayBeTruncated: assessTruncation(row, presence),
        },
      }
    } catch {
      // Continue to other rows.
    } finally {
      if (claim && !keepClaim) await claim.release().catch(() => {})
    }
  }
  return null
}
