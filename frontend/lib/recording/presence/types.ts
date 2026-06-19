import type { RecordingState } from '../sessionTypes'

export const PRESENCE_RECORDING_STATES = [
  'recording',
  'paused',
  'finalizing',
  'uploading',
] as const satisfies readonly RecordingState[]

export type RecordingPresenceState = (typeof PRESENCE_RECORDING_STATES)[number]

const PRESENCE_RECORDING_STATE_SET: ReadonlySet<string> = new Set(
  PRESENCE_RECORDING_STATES
)

export function isRecordingPresenceState(
  value: unknown
): value is RecordingPresenceState {
  return typeof value === 'string' && PRESENCE_RECORDING_STATE_SET.has(value)
}

/**
 * Same-browser recording presence (Phase 4).
 *
 * Lightweight, separate from durable IndexedDB audio: it lets non-owner tabs in
 * the same browser observe that a recording is in progress. It lives in
 * `localStorage` + `BroadcastChannel`, so it must never carry sensitive data —
 * no key terms, no upload intent id. Only an active recording publishes it; the
 * owner tab clears it on terminal cleanup.
 */
export interface RecordingPresence {
  sessionId: string
  /** Random per-tab id so a tab can recognise (and suppress) its own presence. */
  ownerClientId: string
  userId: string
  /** Only the active lifecycle states are ever published. */
  state: RecordingPresenceState
  title: string | null
  startedAt: number
  lastResumeAt: number | null
  pausedAccumulatedMs: number
  bytesSoFar: number
  /** Capture-health signal only; null until the first chunk is persisted. */
  lastChunkSeq: number | null
  lastChunkReceivedAt: number | null
  /** Wall-clock of the last heartbeat publish; drives staleness. */
  heartbeatAt: number
}

/**
 * Adapter seam for publishing/observing same-browser presence. Production uses
 * BroadcastChannel + localStorage; tests use an in-memory fake.
 */
export interface RecordingPresenceChannel {
  /** Owner tab: write/refresh the current presence snapshot. */
  publish(presence: RecordingPresence): void
  /** Owner tab: clear presence on terminal cleanup. */
  clear(): void
  /** Any tab: read the latest snapshot, or null when absent/corrupt. */
  read(): RecordingPresence | null
  /** Any tab: subscribe to live + cross-tab snapshot changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void
}

/** localStorage key holding the latest presence snapshot JSON. */
export const PRESENCE_STORAGE_KEY = 'olivetti:recording:presence'

/** BroadcastChannel name for live presence messages. */
export const PRESENCE_CHANNEL_NAME = 'olivetti-recording'

/** Owner heartbeat cadence. */
export const HEARTBEAT_INTERVAL_MS = 2_000

/**
 * Presence is considered stale after this long without a heartbeat. Lock liveness
 * still wins over a stale heartbeat (see useRemotePresence), so this only governs
 * whether title/timer is trusted, not owner death on its own.
 */
export const PRESENCE_STALE_MS = 15_000
