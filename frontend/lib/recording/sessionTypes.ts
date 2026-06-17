import type { CodecSelection } from './codecs'
import type { SessionWriteQueue } from './persistence'
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
  | 'recoverable'

/**
 * Metadata for a recoverable orphan surfaced to the recovery modal. Carries only
 * what the UI needs — the chunk Blobs are read lazily on save, not held here.
 */
export interface RecoverableInfo {
  sessionId: string
  uploadIntentId: string | null
  title: string | null
  generatedTitle: string | null
  keyTerms: string[]
  codecMime: string | null
  codecExtension: 'webm' | 'mp4' | null
  bytesSoFar: number
  createdAt: number
  /** Number of other valid orphans waiting (for "1 of N" display). */
  remainingCount: number
}

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
  /**
   * Backup/durability status (Phase 3). `true` = the recording is being mirrored
   * to durable local storage; `false` = durability is unavailable from start or
   * has downgraded mid-session. Drives the passive "may be lost" warning. User
   * copy never says "armed" — this is the internal backup signal.
   */
  durable: boolean
  /**
   * Passive capture-health warning text (Phase 3). Non-null when chunks have
   * stopped arriving while still `recording` after a flush was requested. Cleared
   * when capture resumes. Distinct from durability — this is about live audio flow.
   */
  captureHealthWarning: string | null
  // Populated only in the `recoverable` state; null otherwise.
  recoverable: RecoverableInfo | null
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
  acceptingChunks: boolean
  stopInProgress: boolean
  uploadAbortController: AbortController | null
  deviceId: string | null
  codecMime: string | null
  maxBytes: number
  finalizedRecording: FinalizedRecording | null
  // Durable persistence (Phase 1). `sessionId`/`writeQueue` are null when idle;
  // `nextChunkSeq` is the monotonic seq assigned to the next persisted chunk.
  sessionId: string | null
  nextChunkSeq: number
  writeQueue: SessionWriteQueue | null
  // Phase 2: client-generated upload idempotency key for this session; null when
  // idle. Generated at start so a crash before stop still carries its dedup key.
  uploadIntentId: string | null
  // Phase 3 capture-health: wall-clock of the last received chunk (null until the
  // first chunk), and whether a manual flush has already been requested for the
  // current stall so the watchdog escalates on the *second* stale tick, not the
  // first.
  lastChunkReceivedAt: number | null
  flushRequested: boolean
}

export interface Store {
  snapshot: SessionSnapshot
  listeners: Set<() => void>
  intervalId: number | null
  mockLifecycleTimeoutIds: number[]
  runtime: Runtime
}

const EMPTY_KEY_TERMS = Object.freeze([]) as unknown as string[]

export const IDLE_SNAPSHOT: SessionSnapshot = Object.freeze({
  state: 'idle',
  title: null,
  generatedTitle: null,
  startedAt: null,
  lastResumeAt: null,
  pausedAccumulatedMs: 0,
  errorMessage: null,
  keyTerms: EMPTY_KEY_TERMS,
  codecExtension: null,
  bytesSoFar: 0,
  salvageMessage: null,
  canRetryUpload: false,
  durable: true,
  captureHealthWarning: null,
  recoverable: null,
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
