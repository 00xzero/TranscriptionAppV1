import { getPersistence } from '../persistence'
import { NoWebLocksSessionLock } from './noWebLocks'
import type { SessionLock } from './types'
import type { BrowserOwnerLock } from './ownerTypes'
import { WebLocksSessionLock } from './webLocks'
import { WebLocksOwnerLock } from './ownerWebLocks'
import { NoopOwnerLock } from './ownerNoop'

let injected: SessionLock | null = null
let resolved: SessionLock | null = null

let injectedOwner: BrowserOwnerLock | null = null
let resolvedOwner: BrowserOwnerLock | null = null

function webLocksAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.locks?.request === 'function' &&
    typeof navigator.locks?.query === 'function'
  )
}

function detectDefault(): SessionLock {
  if (webLocksAvailable()) {
    return new WebLocksSessionLock()
  }
  return new NoWebLocksSessionLock(getPersistence())
}

/**
 * Returns the active session lock. A test-injected lock wins; otherwise the
 * environment default (Web Locks where available, degraded fallback elsewhere)
 * is memoized — a single holder reused across the tab's lifetime, which is safe
 * because at most one recording-session lock is held at a time.
 */
export function getSessionLock(): SessionLock {
  if (injected) return injected
  if (!resolved) resolved = detectDefault()
  return resolved
}

/** Test hook: inject a fake lock, or pass `null` to restore the default. */
export function __setSessionLockForTesting(lock: SessionLock | null): void {
  injected = lock
  // Drop the memoized default so the next getSessionLock re-detects (and rebinds
  // to the current persistence adapter in the no-Web-Locks fallback).
  resolved = null
}

function detectDefaultOwnerLock(): BrowserOwnerLock {
  if (webLocksAvailable()) {
    return new WebLocksOwnerLock()
  }
  // No Web Locks → no trustworthy cross-tab mutex. Degrade to a no-op rather than
  // emulate one; see NoopOwnerLock for the rationale and the accepted tradeoff.
  return new NoopOwnerLock()
}

/**
 * Returns the global per-browser recording owner mutex (Phase 4). Memoized per
 * tab — at most one owner lock is held at a time. Test-injected lock wins.
 */
export function getOwnerLock(): BrowserOwnerLock {
  if (injectedOwner) return injectedOwner
  if (!resolvedOwner) resolvedOwner = detectDefaultOwnerLock()
  return resolvedOwner
}

/** Test hook: inject a fake owner lock, or pass `null` to restore the default. */
export function __setOwnerLockForTesting(lock: BrowserOwnerLock | null): void {
  injectedOwner = lock
  resolvedOwner = null
}

export type { SessionLock } from './types'
export type { BrowserOwnerLock } from './ownerTypes'
export { recordingLockName } from './types'
export { OWNER_LOCK_NAME } from './ownerTypes'
export { WebLocksSessionLock } from './webLocks'
export { NoWebLocksSessionLock, OWNER_STALE_MS } from './noWebLocks'
export { WebLocksOwnerLock } from './ownerWebLocks'
export { NoopOwnerLock } from './ownerNoop'
export { FakeSessionLock } from './fake'
export { FakeOwnerLock } from './ownerFake'
