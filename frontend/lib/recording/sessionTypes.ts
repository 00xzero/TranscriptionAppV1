import type { CodecSelection } from './codecs'
import type { RecorderController } from './recorderController'

export type RecordingState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'uploading'
  | 'submitted'
  | 'discarded'
  | 'error'
  | 'interrupted'

export interface SessionSnapshot {
  state: RecordingState
  title: string | null
  generatedTitle: string | null
  startedAt: number | null
  lastResumeAt: number | null
  pausedAccumulatedMs: number
  errorMessage: string | null
  keyTerms: string[]
  codecExtension: 'webm' | 'mp4' | null
  bytesSoFar: number
  salvageMessage: string | null
  canRetryUpload: boolean
  submissionResult: {
    projectId: string
    outcome: 'started' | 'saved_needs_retry' | 'saved_status_unknown'
  } | null
}

export interface FinalizedRecording {
  file: File
  title: string
  keyTerms: string[]
}

export interface Runtime {
  controller: RecorderController | null
  chunks: Blob[]
  bytesSoFar: number
  stopInProgress: boolean
  deviceId: string | null
  codecMime: string | null
  maxBytes: number
  finalizedRecording: FinalizedRecording | null
}

export interface Store {
  snapshot: SessionSnapshot
  listeners: Set<() => void>
  intervalId: number | null
  mockLifecycleTimeoutIds: number[]
  runtime: Runtime
}

export interface SessionDraft {
  title: string | null
  generatedTitle: string | null
  keyTerms: string[]
  codecMime: string | null
  deviceId: string | null
}

export const IDLE_SNAPSHOT: SessionSnapshot = Object.freeze({
  state: 'idle',
  title: null,
  generatedTitle: null,
  startedAt: null,
  lastResumeAt: null,
  pausedAccumulatedMs: 0,
  errorMessage: null,
  keyTerms: [],
  codecExtension: null,
  bytesSoFar: 0,
  salvageMessage: null,
  canRetryUpload: false,
  submissionResult: null,
})

export const SERVER_SNAPSHOT: SessionSnapshot = IDLE_SNAPSHOT

export interface StartMockMetadata {
  title?: string | null
  keyTerms?: string[]
}

export interface AttachAndStartParams {
  stream: MediaStream
  codec: CodecSelection
  title: string | null
  keyTerms: string[]
  deviceId: string | null
  maxBytes: number
}

export interface RestartInterruptedResult {
  ok: boolean
  reason?:
    | 'permission_denied'
    | 'no_codec'
    | 'no_draft'
    | 'no_media_devices'
    | 'attach_failed'
    | 'already_active'
  message?: string
}
