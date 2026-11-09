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
import { getIdentity, isRecordingAccountCurrent } from './sessionIdentity'
import { setSnapshot, store } from './sessionStore'
import { IDLE_SNAPSHOT, type RecoverableInfo } from './sessionTypes'
import { downloadRecording } from './downloadRecording'
import {
  beginRecordingSubmission,
  endRecordingSubmission,
  runRecordingSubmission,
} from './sessionUpload'
import { cleanUpConfirmedHandoff } from './confirmedHandoff'
import { isValidRecordingIntent, recordingMediaFilename } from './recordingIntent'

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
    return isRecordingAccountCurrent(probedUserId) &&
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

let busyClaim: SessionClaim | null = null

function beginRecoveryAction(expectedSessionId?: string) {
  const info = store.snapshot.recoverable
  const { recoveryClaim: claim, userId } = store.runtime
  if (!info || !claim || claim.sessionId !== info.sessionId ||
    (expectedSessionId !== undefined && expectedSessionId !== info.sessionId)) {
    throw new Error('This recovered recording is no longer available.')
  }
  if (!userId || !isRecordingAccountCurrent(userId)) {
    throw new Error('Sign in to the original account to use this recording.')
  }
  if (busyClaim) throw new Error('An action is already running for this recording.')
  busyClaim = claim
  return { info, claim, userId, persistence: getPersistence() }
}

type RecoveryAction = ReturnType<typeof beginRecoveryAction>

async function releaseRecoveryClaim(claim: SessionClaim): Promise<void> {
  await releaseSessionLockQuietly(claim)
  if (store.runtime.recoveryClaim === claim) {
    store.runtime.recoveryClaim = null
    store.runtime.userId = null
  }
}

export function closeRecoveryForAccountChange(): void {
  const claim = store.runtime.recoveryClaim
  if (!claim || claim === busyClaim) return
  void releaseRecoveryClaim(claim)
  setSnapshot({ ...IDLE_SNAPSHOT })
}

function canContinueRecovery(action: RecoveryAction): boolean {
  return store.runtime.recoveryClaim === action.claim && isRecordingAccountCurrent(action.userId)
}

async function finishRecoveryAction(action: RecoveryAction): Promise<void> {
  if (busyClaim === action.claim) busyClaim = null
  if (store.runtime.recoveryClaim === action.claim && !isRecordingAccountCurrent(action.userId)) {
    await releaseRecoveryClaim(action.claim)
    setSnapshot({ ...IDLE_SNAPSHOT })
  }
}

async function readRecoveredFile({ info, persistence }: RecoveryAction): Promise<File> {
  const chunks = await persistence.readChunks(info.sessionId)
  if (chunks.length === 0) throw new Error('The recovered audio is empty.')
  return new File(chunks, recordingMediaFilename(info.uploadIntentId, info.codecExtension), {
    type: (info.codecMime ?? 'audio/webm').split(';')[0],
  })
}

export async function exportRecovered(expectedSessionId: string): Promise<void> {
  const action = beginRecoveryAction(expectedSessionId)
  try {
    const file = await readRecoveredFile(action)
    if (canContinueRecovery(action)) downloadRecording(file)
  } finally {
    await finishRecoveryAction(action)
  }
}

async function releaseAndChain(action: RecoveryAction): Promise<boolean> {
  await releaseRecoveryClaim(action.claim)
  if (!isRecordingAccountCurrent(action.userId)) {
    setSnapshot({ ...IDLE_SNAPSHOT })
    return false
  }
  return runRecoveryProbe(action.claim.sessionId).catch(() => false)
}

export interface SaveRecoveredResult {
  ok: boolean
  message?: string
}

export async function saveRecovered(editedTitle: string, expectedSessionId?: string): Promise<SaveRecoveredResult> {
  let action: RecoveryAction | undefined
  let controller: AbortController | null = null
  try {
    action = beginRecoveryAction(expectedSessionId)
    const { info, userId } = action
    if (!isValidRecordingIntent(info.uploadIntentId)) {
      throw new Error('This recovered recording is available for download only.')
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error("You're offline. Reconnect to save this recording.")
    }

    controller = beginRecordingSubmission()
    if (!controller) throw new Error('A recording upload is already running.')
    const file = await readRecoveredFile(action)
    if (!canContinueRecovery(action)) throw new Error('Sign in to the original account before saving.')
    const title = editedTitle.trim() || info.title || info.generatedTitle ||
      `Recording — ${new Date(info.createdAt).toISOString()}`
    const result = await runRecordingSubmission({
      file,
      title,
      keyTerms: info.keyTerms,
      projectId: info.projectId,
      transcriptionOptions: info.transcriptionOptions,
    }, userId, info.uploadIntentId, controller)

    if (result.kind !== 'success') return { ok: false, message: result.message }
    await cleanUpConfirmedHandoff(action.persistence, info.sessionId, userId, result.outcome)
    const chainedToNext = await releaseAndChain(action)
    if (!isRecordingAccountCurrent(userId)) return { ok: true }
    setSnapshot({
      ...(chainedToNext ? store.snapshot : { ...IDLE_SNAPSHOT, state: 'submitted' }),
      submissionResult: {
        transcriptId: result.transcriptId,
        outcome: result.outcome,
        warning: result.warning,
        recovered: true,
      },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, message: (err as Error)?.message ?? 'Could not save the recording.' }
  } finally {
    if (controller) endRecordingSubmission(controller)
    if (action) await finishRecoveryAction(action)
  }
}

export async function discardRecovered(expectedSessionId?: string): Promise<void> {
  const action = beginRecoveryAction(expectedSessionId)
  try {
    await action.persistence.deleteSession(action.claim.sessionId)
    const chainedToNext = await releaseAndChain(action)
    if (!chainedToNext) setSnapshot({ ...IDLE_SNAPSHOT })
  } finally {
    await finishRecoveryAction(action)
  }
}
