import {
  isRemoteRecordingBlockingKind,
  type RemotePresenceStatus,
} from './useRemotePresence'
import type { SessionSnapshot } from './sessionTypes'

export function shouldRedirectMissingRecordingSession(input: {
  state: SessionSnapshot['state']
  remoteKind: RemotePresenceStatus['kind']
  devControlsEnabled: boolean
}): boolean {
  if (input.state !== 'idle') return false
  if (input.devControlsEnabled) return false
  if (input.remoteKind === 'checking') return false
  return !isRemoteRecordingBlockingKind(input.remoteKind)
}
