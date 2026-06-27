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
  sweepExpiredSessions,
  validateChunkStream,
  type PersistedSession,
  type SessionPersistence,
} from './persistence'
import type { SessionLock } from './lock'
import { getPresence, type RecordingPresence } from './presence'
import type { RecoverableInfo } from './sessionTypes'

export interface RecoveryProbeResult {
  info: RecoverableInfo
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

export async function probeRecoverableSessions(
  persistence: SessionPersistence,
  lock: SessionLock,
  userId: string,
  now: number = Date.now(),
  excludeSessionId: string | null = null,
  readPresence: () => RecordingPresence | null = () => getPresence().read()
): Promise<RecoveryProbeResult | null> {
  // Single list pass: feed the rows through the opportunistic 7-day sweep and
  // probe the survivors. Avoids a second full listSessions()+parse pass.
  let rows: PersistedSession[]
  try {
    const listed = await persistence.listSessions()
    const swept = await sweepExpiredSessions(persistence, listed, now)
    rows = swept.survivors
  } catch {
    return null
  }

  // Privacy gate + newest-first. Null/foreign userId rows are never surfaced
  // (left for GC). The live session in this tab, if any, is excluded.
  const candidates = rows
    .filter((row) => row.userId === userId && row.sessionId !== excludeSessionId)
    .sort((a, b) => b.createdAt - a.createdAt)

  // Single presence read for the whole probe: localStorage holds one snapshot (the
  // most recent session), matched per-candidate by sessionId. A throwing reader is
  // treated as no snapshot so assessTruncation falls back to the `armed` flag.
  let presence: RecordingPresence | null
  try {
    presence = readPresence()
  } catch {
    presence = null
  }

  let claimed: RecoverableInfo | null = null
  let remaining = 0

  for (const row of candidates) {
    // Owner pre-filter (read-only): never validate or delete a session a live
    // tab is actively writing.
    let held = false
    try {
      held = await lock.isHeld(row.sessionId)
    } catch {
      continue
    }
    if (held) continue

    let seqs: number[]
    try {
      seqs = await persistence.listChunkSeqs(row.sessionId)
    } catch {
      continue
    }

    const mime = codecMimeFor(row)
    const streamValidation = validateChunkStream(seqs)

    if (!streamValidation.valid || mime === null) {
      // Unrecoverable orphan (no init chunk, gap, or no codec) — silently clean
      // it up.
      try {
        await persistence.deleteSession(row.sessionId)
      } catch {
        // best-effort
      }
      continue
    }

    let recoveredBytes = 0
    try {
      // Metadata-only summary — never materializes the audio Blobs. Counting +
      // byte-summing here on the startup hot path with readChunks would spike
      // memory by tens/hundreds of MB; the save path re-reads the bytes later.
      const stats = await persistence.chunkStats(row.sessionId)
      // The chunk stream is authoritative for the recovery floor. bytesSoFar is
      // advisory metadata and can lag behind a successfully persisted chunk if
      // the tab crashes between the chunk write and metadata patch.
      if (stats.count !== seqs.length) {
        // Contiguous seqs but a chunk row is missing/unreadable, so the stream
        // can't be reassembled. The session passed the owner pre-filter (no live
        // tab is writing it), so this is permanent corruption — clean it up like
        // the invalid-stream and below-floor branches rather than re-probing it
        // forever until the 7-day GC.
        try {
          await persistence.deleteSession(row.sessionId)
        } catch {
          // best-effort
        }
        continue
      }
      recoveredBytes = stats.totalBytes
    } catch {
      continue
    }

    if (!meetsRecoveryFloor(recoveredBytes)) {
      // Below-floor audio is valid structurally but too small to be useful.
      try {
        await persistence.deleteSession(row.sessionId)
      } catch {
        // best-effort
      }
      continue
    }

    if (claimed) {
      // A newer orphan is already claimed; count the rest for "1 of N".
      remaining++
      continue
    }

    // Claim it: only the tab that acquires the lock surfaces the modal.
    let acquired = false
    try {
      acquired = await lock.acquire(row.sessionId)
    } catch {
      acquired = false
    }
    if (!acquired) continue

    claimed = {
      sessionId: row.sessionId,
      uploadIntentId: row.uploadIntentId,
      title: row.title,
      generatedTitle: row.generatedTitle,
      keyTerms: row.keyTerms,
      codecMime: mime as string,
      codecExtension: row.codecExtension,
      bytesSoFar: recoveredBytes,
      createdAt: row.createdAt,
      remainingCount: 0,
      mayBeTruncated: assessTruncation(row, presence),
    }
  }

  if (!claimed) return null
  claimed.remainingCount = remaining
  return { info: claimed }
}
