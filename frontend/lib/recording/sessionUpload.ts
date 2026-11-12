/**
 * Shared recording submission and the live session's upload transitions.
 * Recovered attempts use the same executor and keep their own claim and cleanup.
 */

import {
  dispatch,
  markError,
  markSubmitted,
  releaseFrozenLiveRecording,
  setSubmissionResult,
  setUploadBytes,
} from './sessionCore'
import { disposeController } from './sessionRuntime'
import { setSnapshot, store } from './sessionStore'
import { runCaptureUpload, type CaptureUploadResult } from '@/lib/capture/upload'
import type { FinalizedRecording, RecordingUploadPhase } from './sessionTypes'
import { getPersistence } from './persistence'
import { cleanUpConfirmedHandoff } from './confirmedHandoff'
import { isValidRecordingIntent } from './recordingIntent'
import { canCancelRecordingUpload } from './uploadProgress'
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/auth/account-boundary'
import { isRecordingAccountCurrent } from './sessionIdentity'
import { downloadRecording } from './downloadRecording'

function markUploadError(message: string): void {
  disposeController(store)
  markError(message)
}

export function beginRecordingSubmission(phase: 'preparing' | 'creating'): AbortController | null {
  if (store.runtime.uploadAbortController) return null
  const controller = new AbortController()
  store.runtime.uploadAbortController = controller
  setSnapshot({ ...store.snapshot, uploadPhase: phase })
  return controller
}

export function endRecordingSubmission(controller: AbortController): void {
  if (store.runtime.uploadAbortController === controller) {
    store.runtime.uploadAbortController = null
    setSnapshot({ ...store.snapshot, uploadPhase: null, uploadBytes: null })
  }
}

export function setRecordingUploadPhase(controller: AbortController, phase: RecordingUploadPhase): void {
  if (store.runtime.uploadAbortController === controller) {
    setSnapshot({ ...store.snapshot, uploadPhase: phase })
  }
}

export function cancelRecordingUpload(expectedSessionId?: string): void {
  const { uploadAbortController: controller, recoveryClaim, userId } = store.runtime
  if (!controller || recoveryClaim?.sessionId !== expectedSessionId ||
    !canCancelRecordingUpload(store.snapshot.uploadPhase) || !isRecordingAccountCurrent(userId)) return
  setRecordingUploadPhase(controller, 'canceling')
  controller.abort()
}

export async function runRecordingSubmission(
  recording: FinalizedRecording,
  userId: string,
  uploadIntentId: string | null,
  controller: AbortController
): Promise<CaptureUploadResult> {
  if (!isRecordingAccountCurrent(userId)) {
    return { kind: 'failure', message: ACCOUNT_CHANGED_MESSAGE }
  }
  if (!isValidRecordingIntent(uploadIntentId)) {
    return { kind: 'failure', message: 'This recording is available for download only.' }
  }
  if (controller.signal.aborted) return { kind: 'failure', message: 'Upload canceled.' }
  setRecordingUploadPhase(controller, 'creating')
  const updateBytes = (sent: number, total: number) => {
    if (store.runtime.uploadAbortController === controller && !controller.signal.aborted) {
      setUploadBytes({ sent, total })
    }
  }
  try {
    return await runCaptureUpload(recording.file, recording.title, recording.keyTerms, {
      userId,
      uploadIntentId,
      projectId: recording.projectId,
      transcriptionOptions: recording.transcriptionOptions,
      signal: controller.signal,
      onProgress: (stage) => {
        if (stage === 'uploading') updateBytes(0, recording.file.size)
      },
      onUploadBytes: updateBytes,
      onTransferPhase: (phase) => {
        if (!controller.signal.aborted) setRecordingUploadPhase(controller, phase)
      },
    })
  } catch (err) {
    return { kind: 'failure', message: (err as Error)?.message ?? 'Could not upload the recording.' }
  }
}

export async function submitFinalizedRecording(): Promise<void> {
  const { finalizedRecording, userId, uploadIntentId, sessionClaim, writeQueue } = store.runtime
  if (!finalizedRecording) {
    markError('No finalized recording is available to upload.')
    return
  }
  if (!userId || !isRecordingAccountCurrent(userId)) {
    markUploadError(ACCOUNT_CHANGED_MESSAGE)
    releaseFrozenLiveRecording()
    return
  }

  const controller = beginRecordingSubmission('creating')
  if (!controller) return
  try {
    if (!dispatch('markUploading')) return
    writeQueue?.enqueueMetadata({ phase: 'uploading' })
    const result = await runRecordingSubmission(finalizedRecording, userId, uploadIntentId, controller)
    if (store.runtime.uploadAbortController !== controller) return

    if (result.kind === 'success') {
      setRecordingUploadPhase(controller, 'settling')
      if (sessionClaim) {
        await cleanUpConfirmedHandoff(getPersistence(), sessionClaim.sessionId, userId, result.outcome, writeQueue)
        if (store.runtime.writeQueue === writeQueue) store.runtime.writeQueue = null
      }
      setSubmissionResult({
        transcriptId: result.transcriptId,
        outcome: result.outcome,
        warning: result.warning,
      })
      endRecordingSubmission(controller)
      markSubmitted()
    } else {
      endRecordingSubmission(controller)
      markUploadError(result.message)
      if (!isRecordingAccountCurrent(userId)) releaseFrozenLiveRecording()
    }
  } finally {
    endRecordingSubmission(controller)
  }
}

/**
 * The stopped recording's audio while it is held in memory to upload (it
 * stays there after a failed upload, for a retry). The only copy when the
 * device can't keep recordings (`snapshot.durable` false).
 */
export function getFinalizedRecordingFile(): File | null {
  return store.runtime.finalizedRecording?.file ?? null
}

export function exportFinalizedRecording(): void {
  if (!isRecordingAccountCurrent(store.runtime.userId)) throw new Error(ACCOUNT_CHANGED_MESSAGE)
  const file = getFinalizedRecordingFile()
  if (!file || store.snapshot.state !== 'error') throw new Error('No recording is available to download.')
  downloadRecording(file)
}

export async function retryFinalizedUpload(): Promise<void> {
  if (store.runtime.stopInProgress) return
  if (!store.runtime.finalizedRecording) return

  store.runtime.stopInProgress = true
  try {
    await submitFinalizedRecording()
  } finally {
    store.runtime.stopInProgress = false
  }
}
