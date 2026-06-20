/**
 * Upload orchestration: drives a finalized recording through the capture upload
 * and maps the result onto the session state machine (submitted / retryable
 * error). Also owns the storage filename helper, since that name is part of the
 * upload/storage idempotency contract and is shared by the live finalize path and
 * recovery save.
 */

import {
  dispatch,
  markError,
  markSubmitted,
  setSubmissionResult,
} from './sessionCore'
import { disposeController } from './sessionRuntime'
import { store } from './sessionStore'
import { runCaptureUpload } from '@/lib/capture/upload'

// Storage filename for an uploaded recording. Keyed on uploadIntentId so the live
// finalize path and any later recovery save of the SAME recording produce the
// identical name: server dedup recomputes the storage path via
// getMediaPath(userId, projectId, filename), so a divergent name would re-upload
// to a new path on a dedup hit and orphan the originally-uploaded object. The
// timestamp fallback is only reached when no intent id exists, in which case
// create never dedups (no cross-path collision is possible).
export function recordingMediaFilename(
  uploadIntentId: string | null,
  codecExtension: string | null
): string {
  const ext = codecExtension ?? 'webm'
  const stable = uploadIntentId ?? `t${Date.now()}`
  return `recording-${stable}.${ext}`
}

function markUploadError(message: string): void {
  disposeController(store)
  markError(message)
}

export async function submitFinalizedRecording(): Promise<void> {
  const finalized = store.runtime.finalizedRecording
  if (!finalized) {
    markError('No finalized recording is available to upload.')
    return
  }

  if (!dispatch('markUploading')) return
  if (store.snapshot.state !== 'uploading') return

  // Persist the phase transition (advisory) after it has applied.
  store.runtime.writeQueue?.enqueueMetadata({ phase: 'uploading' })

  const abortController = new AbortController()
  store.runtime.uploadAbortController = abortController

  let result: Awaited<ReturnType<typeof runCaptureUpload>>
  try {
    result = await runCaptureUpload(
      finalized.file,
      finalized.title,
      finalized.keyTerms,
      {
        signal: abortController.signal,
        uploadIntentId: store.runtime.uploadIntentId ?? undefined,
      }
    )
  } finally {
    if (store.runtime.uploadAbortController === abortController) {
      store.runtime.uploadAbortController = null
    }
  }
  if (abortController.signal.aborted || store.snapshot.state !== 'uploading') {
    return
  }

  if (result.kind === 'success') {
    setSubmissionResult({
      projectId: result.projectId,
      outcome: result.outcome,
    })
    markSubmitted()
  } else {
    markUploadError(result.message)
  }
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
