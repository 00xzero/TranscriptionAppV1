import type { RecordingUploadPhase } from './sessionTypes'

export function canCancelRecordingUpload(phase: RecordingUploadPhase | null): boolean {
  return phase === 'preparing' || phase === 'creating' || phase === 'uploading'
}

export const RECORDING_UPLOAD_MESSAGES: Record<RecordingUploadPhase, string> = {
  preparing: 'Preparing recording…',
  creating: 'Creating transcript…',
  uploading: 'Uploading recording…',
  single_transfer: 'Uploading recording… This transfer must finish before it can be canceled.',
  linking: 'Saving audio to the transcript…',
  starting: 'Starting transcription…',
  settling: 'Finishing save…',
  canceling: 'Canceling upload…',
}
