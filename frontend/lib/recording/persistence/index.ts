import { IndexedDBSessionPersistence } from './indexedDb'
import { NoOpSessionPersistence } from './noop'
import type { SessionPersistence } from './types'

let injected: SessionPersistence | null = null
let resolved: SessionPersistence | null = null

function detectDefault(): SessionPersistence {
  if (typeof indexedDB !== 'undefined') {
    try {
      return new IndexedDBSessionPersistence()
    } catch {
      return new NoOpSessionPersistence()
    }
  }
  return new NoOpSessionPersistence()
}

/**
 * Returns the active persistence adapter. A test-injected adapter wins; otherwise
 * the environment default (IndexedDB in browsers, no-op elsewhere) is memoized.
 */
export function getPersistence(): SessionPersistence {
  if (injected) return injected
  if (!resolved) resolved = detectDefault()
  return resolved
}

/** Test hook: inject a fake adapter, or pass `null` to restore the default. */
export function __setPersistenceForTesting(
  persistence: SessionPersistence | null
): void {
  injected = persistence
}

export type {
  PersistedSession,
  PersistedSessionPatch,
  PersistedSessionPhase,
  SessionPersistence,
} from './types'
export { PersistedSessionSchema, PersistedSessionPhaseSchema } from './types'
export { SessionWriteQueue } from './writeQueue'
export {
  validateChunkStream,
  meetsRecoveryFloor,
  type ChunkStreamValidation,
  type ChunkStreamInvalidReason,
} from './validation'
export { gcExpiredSessions, SESSION_MAX_AGE_MS } from './gc'
export { requestPersistentStorage } from './storagePersist'
export { IndexedDBSessionPersistence } from './indexedDb'
export { InMemorySessionPersistence } from './inMemory'
export { NoOpSessionPersistence } from './noop'
