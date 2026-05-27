import {
  __setSnapshotForTesting,
  forceState,
  type RecordingState,
  type SessionSnapshot,
} from '@/lib/recording/session'

interface MockOptions {
  state: RecordingState
  title?: string | null
  generatedTitle?: string | null
  pausedAccumulatedMs?: number
  startedAt?: number | null
  lastResumeAt?: number | null
  errorMessage?: string | null
  keyTerms?: string[]
  codecExtension?: 'webm' | 'mp4' | null
  bytesSoFar?: number
  salvageMessage?: string | null
  submissionResult?: SessionSnapshot['submissionResult']
}

export function mockRecordingSession(options: MockOptions): void {
  const partial: Partial<SessionSnapshot> = {}
  if ('title' in options) partial.title = options.title ?? null
  if ('generatedTitle' in options)
    partial.generatedTitle = options.generatedTitle ?? null
  if ('pausedAccumulatedMs' in options)
    partial.pausedAccumulatedMs = options.pausedAccumulatedMs ?? 0
  if ('startedAt' in options) partial.startedAt = options.startedAt ?? null
  if ('lastResumeAt' in options)
    partial.lastResumeAt = options.lastResumeAt ?? null
  if ('errorMessage' in options)
    partial.errorMessage = options.errorMessage ?? null
  if ('keyTerms' in options) partial.keyTerms = options.keyTerms ?? []
  if ('codecExtension' in options)
    partial.codecExtension = options.codecExtension ?? null
  if ('bytesSoFar' in options) partial.bytesSoFar = options.bytesSoFar ?? 0
  if ('salvageMessage' in options)
    partial.salvageMessage = options.salvageMessage ?? null
  if ('submissionResult' in options)
    partial.submissionResult = options.submissionResult ?? null
  __setSnapshotForTesting(partial)
  forceState(options.state)
}
