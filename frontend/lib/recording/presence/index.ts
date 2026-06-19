import { BroadcastChannelPresence } from './broadcastChannel'
import { NoopPresence } from './noop'
import type { RecordingPresenceChannel } from './types'

let injected: RecordingPresenceChannel | null = null
let resolved: RecordingPresenceChannel | null = null

// Presence is only meaningful alongside a real owner mutex: without the Web Locks
// API there is no trustworthy way to tell a live-but-backgrounded owner from a
// dead one, so same-browser coordination is turned off as a unit (NoopOwnerLock +
// NoopPresence). Gating here on Web Locks — not BroadcastChannel — keeps that a
// single on/off rather than a half-working hybrid on old engines.
function webLocksAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.locks?.request === 'function' &&
    typeof navigator.locks?.query === 'function'
  )
}

function detectDefault(): RecordingPresenceChannel {
  if (typeof window === 'undefined') return new NoopPresence()
  if (webLocksAvailable() && typeof BroadcastChannel === 'function') {
    return new BroadcastChannelPresence()
  }
  return new NoopPresence()
}

/**
 * Returns the active presence adapter. A test-injected adapter wins; otherwise
 * the environment default (BroadcastChannel where available, localStorage-only
 * fallback, noop on the server) is memoized for the tab's lifetime.
 */
export function getPresence(): RecordingPresenceChannel {
  if (injected) return injected
  if (!resolved) resolved = detectDefault()
  return resolved
}

export function clearPresenceForSession(sessionId: string): void {
  try {
    const channel = getPresence()
    if (channel.read()?.sessionId === sessionId) {
      channel.clear()
    }
  } catch {
    // Presence is best-effort; cleanup failures must not break recovery.
  }
}

/** Test hook: inject a fake adapter, or pass `null` to restore the default. */
export function __setPresenceForTesting(channel: RecordingPresenceChannel | null): void {
  injected = channel
  resolved = null
}

export type { RecordingPresence, RecordingPresenceChannel } from './types'
export {
  HEARTBEAT_INTERVAL_MS,
  isRecordingPresenceState,
  PRESENCE_RECORDING_STATES,
  PRESENCE_STALE_MS,
  PRESENCE_STORAGE_KEY,
  PRESENCE_CHANNEL_NAME,
} from './types'
export { getOwnerClientId, __setOwnerClientIdForTesting } from './clientId'
export { BroadcastChannelPresence } from './broadcastChannel'
export { NoopPresence } from './noop'
export { FakeRecordingPresence, FakePresenceBus } from './fake'
export { parsePresence } from './validate'
