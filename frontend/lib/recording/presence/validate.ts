import {
  isRecordingPresenceState,
  type RecordingPresence,
} from './types'

/**
 * Defensive parse for a presence snapshot read from localStorage. Presence is
 * untrusted on read: another tab (possibly an older app version) wrote it, so a
 * malformed or stale-schema value must yield `null` rather than throw or surface
 * a half-populated object. Only the fields the UI relies on are required.
 */
export function parsePresence(raw: string | null): RecordingPresence | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const p = value as Record<string, unknown>

  if (
    typeof p.sessionId !== 'string' ||
    typeof p.ownerClientId !== 'string' ||
    typeof p.userId !== 'string' ||
    !isRecordingPresenceState(p.state) ||
    typeof p.startedAt !== 'number' ||
    typeof p.heartbeatAt !== 'number' ||
    typeof p.pausedAccumulatedMs !== 'number' ||
    typeof p.bytesSoFar !== 'number'
  ) {
    return null
  }

  return {
    sessionId: p.sessionId,
    ownerClientId: p.ownerClientId,
    userId: p.userId,
    state: p.state,
    title: typeof p.title === 'string' ? p.title : null,
    startedAt: p.startedAt,
    lastResumeAt: typeof p.lastResumeAt === 'number' ? p.lastResumeAt : null,
    pausedAccumulatedMs: p.pausedAccumulatedMs,
    bytesSoFar: p.bytesSoFar,
    lastChunkSeq: typeof p.lastChunkSeq === 'number' ? p.lastChunkSeq : null,
    lastChunkReceivedAt:
      typeof p.lastChunkReceivedAt === 'number' ? p.lastChunkReceivedAt : null,
    heartbeatAt: p.heartbeatAt,
  }
}
