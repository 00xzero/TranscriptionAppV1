/**
 * Recovery + interruption orchestration: surfaces orphaned recordings as the
 * blocking `recoverable` state, and drives the save/discard (with defensive
 * multi-orphan chaining) and post-interruption recovery flows. Builds on the
 * transition kernel (`sessionCore`) plus the persistence probe; it never imports
 * the recorder lifecycle.
 */

import { getSessionLock, type SessionClaim } from './lock'
import { getPersistence, type SessionWriteQueue } from './persistence'
import { probeRecoverableSessions } from './recovery'
import {
  dispatch,
  releaseLiveOwnership,
  releaseSessionLockQuietly,
} from './sessionCore'
import { getIdentity } from './sessionIdentity'
import { setSnapshot, store } from './sessionStore'
import { IDLE_SNAPSHOT, type RecoverableInfo } from './sessionTypes'
import type { CreateTranscriptWarning } from '@/contracts/api'
import { recordingMediaFilename } from './sessionUpload'
import { runCaptureUpload } from '@/lib/capture/upload'

export function markInterrupted(message?: string): void {
  // Capture the queue before dispatch detaches it from runtime, so its pending
  // writes can settle before we probe. Only finalize recovery when the state
  // transition was accepted; a rejected transition must not release ownership.
  const queue = store.runtime.writeQueue
  const claim = store.runtime.sessionClaim
  if (dispatch('markInterrupted', { errorMessage: message ?? null })) {
    void finalizeInterruptedRecovery(queue, claim)
  }
}

// After an interruption the live recorder is gone but the tab is alive and the
// chunks remain in IDB. Once writes settle, release the lock so the orphan is
// claimable, then probe: if the persisted audio is valid it surfaces as
// recoverable; otherwise it is silently cleaned up and we stay interrupted.
async function finalizeInterruptedRecovery(
  queue: SessionWriteQueue | null,
  claim: SessionClaim | null
): Promise<void> {
  try {
    if (queue) await queue.whenSettled()
  } catch {
    // ignore — best-effort
  }
  // The live owner is gone: clear presence first, then drop ownership so the
  // orphan is claimable (by this tab's probe or another tab) without remote tabs
  // momentarily seeing a fresh heartbeat for a session that is no longer live.
  await releaseLiveOwnership(claim)
  try {
    await runRecoveryProbe()
  } catch {
    // ignore — best-effort
  }
}

function hydrateRecoverable(info: RecoverableInfo, userId: string, claim: SessionClaim): void {
  store.runtime.userId = userId
  store.runtime.recoveryClaim = claim
  setSnapshot({
    ...IDLE_SNAPSHOT,
    state: 'recoverable',
    projectId: info.projectId,
    title: info.title,
    generatedTitle: info.generatedTitle,
    keyTerms: info.keyTerms,
    transcriptionOptions: info.transcriptionOptions,
    codecExtension: info.codecExtension,
    bytesSoFar: info.bytesSoFar,
    recoverable: info,
  })
}

// Recovery may only surface from a non-live state: idle, interrupted, or while
// already showing a recoverable (to chain to the next orphan after save/discard).
function isRecoveryEligibleState(): boolean {
  return (
    store.snapshot.state === 'idle' ||
    store.snapshot.state === 'interrupted' ||
    store.snapshot.state === 'recoverable'
  )
}

/**
 * Probe IDB for a recoverable orphan belonging to the current user and, if found,
 * hydrate the blocking recoverable state. Safe from idle, interrupted, or while
 * already showing a recoverable (to chain to the next orphan after save/discard).
 * Returns true when a recoverable session was surfaced.
 */
let pendingProbe: Promise<boolean> | null = null

export function runRecoveryProbe(excludeSessionId?: string | null): Promise<boolean> {
  if (pendingProbe) return pendingProbe
  pendingProbe = probeAndHydrate(excludeSessionId).finally(() => { pendingProbe = null })
  return pendingProbe
}

async function probeAndHydrate(excludeSessionId?: string | null): Promise<boolean> {
  const identity = getIdentity()
  if (!identity.ready || !identity.userId) return false
  const probedUserId = identity.userId

  const canProceed = () => {
    const current = getIdentity()
    return current.ready && current.userId === probedUserId &&
      !store.runtime.sessionClaim && !store.runtime.recoveryClaim && isRecoveryEligibleState()
  }
  if (!canProceed()) return false

  // Exclude an explicitly-resolved orphan (recovery chaining) so a failed
  // deleteSession can't make this same probe re-surface it in a loop; otherwise
  // exclude the live session, if any.
  const result = await probeRecoverableSessions(
    getPersistence(),
    getSessionLock(),
    probedUserId,
    Date.now(),
    excludeSessionId ?? store.runtime.sessionId,
    undefined,
    canProceed
  )

  if (!result) return false

  if (!canProceed()) {
    await releaseSessionLockQuietly(result.claim)
    return false
  }

  hydrateRecoverable(result.info, probedUserId, result.claim)
  return true
}

// Shared save/discard tail: delete the resolved orphan, release its lock, then
// chain to the next orphan (defensive multi-orphan handling). Returns true when a
// subsequent recoverable was surfaced — callers use that to decide whether to
// apply their own terminal snapshot.
interface ClearRecoveredResult {
  ok: boolean
  chainedToNext: boolean
  message?: string
}

async function clearRecoveredOrphanAndChain(
  sessionId: string
): Promise<ClearRecoveredResult> {
  const claim = store.runtime.recoveryClaim
  if (claim?.sessionId !== sessionId) {
    return { ok: false, chainedToNext: false, message: 'The recovery claim is no longer available.' }
  }
  try {
    await getPersistence().deleteSession(sessionId)
  } catch (err) {
    return {
      ok: false,
      chainedToNext: false,
      message: (err as Error)?.message ?? 'Could not delete the recovered recording.',
    }
  }
  await releaseSessionLockQuietly(claim)
  store.runtime.recoveryClaim = null
  try {
    return {
      ok: true,
      chainedToNext: await runRecoveryProbe(sessionId),
    }
  } catch {
    return { ok: true, chainedToNext: false }
  }
}

export interface SaveRecoveredResult {
  ok: boolean
  message?: string
  warning?: CreateTranscriptWarning
  /**
   * True when the save succeeded and another recovered orphan was immediately
   * surfaced. The caller shows a confirmation toast in this case (the next modal
   * replaces the redirect that a final save performs).
   */
  chainedToNext?: boolean
}

export async function saveRecovered(editedTitle: string): Promise<SaveRecoveredResult> {
  const info = store.snapshot.recoverable
  if (!info) return { ok: false, message: 'No recovered recording to save.' }
  const userId = store.runtime.userId
  if (!userId) return { ok: false, message: 'Sign in to the original account before saving this recording.' }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      ok: false,
      message: "You're offline. Reconnect to save this recording.",
    }
  }

  const persistence = getPersistence()
  let blobs: Blob[]
  try {
    blobs = await persistence.readChunks(info.sessionId)
  } catch {
    return { ok: false, message: 'Could not read the recovered audio.' }
  }
  if (blobs.length === 0) {
    return { ok: false, message: 'The recovered audio is empty.' }
  }

  const normalizedMime = (info.codecMime ?? 'audio/webm').split(';')[0]
  const file = new File(
    blobs,
    recordingMediaFilename(info.uploadIntentId, info.codecExtension),
    { type: normalizedMime }
  )
  const title =
    editedTitle.trim() ||
    info.title ||
    info.generatedTitle ||
    `Recording — ${new Date(info.createdAt).toISOString()}`

  let result: Awaited<ReturnType<typeof runCaptureUpload>>
  try {
    result = await runCaptureUpload(file, title, info.keyTerms, {
      userId,
      uploadIntentId: info.uploadIntentId ?? undefined,
      projectId: info.projectId,
      transcriptionOptions: info.transcriptionOptions,
    })
  } catch (err) {
    return {
      ok: false,
      message: (err as Error)?.message ?? 'Could not save the recording.',
    }
  }

  if (result.kind !== 'success') {
    // Leave the IDB row intact so the user can retry safely (server dedup makes
    // a repeated save idempotent).
    return { ok: false, message: result.message ?? 'Could not save the recording.' }
  }

  // Success: clear the orphan and release ownership, then surface the next orphan
  // (defensive multi-orphan handling) or finish as submitted.
  const cleared = await clearRecoveredOrphanAndChain(info.sessionId)
  if (!cleared.ok) {
    return {
      ok: false,
      message:
        cleared.message ??
        'Recording was saved, but the local recovery copy could not be removed.',
    }
  }
  if (!cleared.chainedToNext) {
    setSnapshot({
      ...store.snapshot,
      state: 'submitted',
      recoverable: null,
      submissionResult: {
        transcriptId: result.transcriptId,
        outcome: result.outcome,
        warning: result.warning,
      },
    })
  }
  return {
    ok: true,
    chainedToNext: cleared.chainedToNext,
    warning: result.warning,
  }
}

export async function discardRecovered(): Promise<void> {
  const info = store.snapshot.recoverable
  if (!info) return

  const cleared = await clearRecoveredOrphanAndChain(info.sessionId)
  if (!cleared.ok) {
    throw new Error(cleared.message ?? 'Could not discard the recording.')
  }
  if (!cleared.chainedToNext) {
    setSnapshot({ ...IDLE_SNAPSHOT })
  }
}
