import {
  __setSnapshotForTesting,
  forceState,
  type RecordingState,
  type SessionSnapshot,
} from '@/lib/recording/session'

interface MockOptions {
  state: RecordingState
  title?: string | null
  pausedAccumulatedMs?: number
  startedAt?: number | null
  lastResumeAt?: number | null
  errorMessage?: string | null
}

export function mockRecordingSession(options: MockOptions): void {
  const partial: Partial<SessionSnapshot> = {}
  if ('title' in options) partial.title = options.title ?? null
  if ('pausedAccumulatedMs' in options)
    partial.pausedAccumulatedMs = options.pausedAccumulatedMs ?? 0
  if ('startedAt' in options) partial.startedAt = options.startedAt ?? null
  if ('lastResumeAt' in options)
    partial.lastResumeAt = options.lastResumeAt ?? null
  if ('errorMessage' in options)
    partial.errorMessage = options.errorMessage ?? null
  __setSnapshotForTesting(partial)
  forceState(options.state)
}
