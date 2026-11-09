/**
 * Ownership lock for a recording session.
 *
 * Phase 2 uses this for exactly one question: "is this specific persisted session
 * still owned by a live tab?" — the recovery owner-check. The owning tab holds
 * the lock for the whole active lifecycle (recording → uploading) and through an
 * in-tab recoverable state; recovery in another tab *claims* the lock via
 * `acquire` before surfacing the modal, so two tabs cannot both recover the same
 * session.
 *
 * It is intentionally NOT a global per-browser mutex (two tabs can each own a
 * different session). Cross-tab duplicate-start blocking + presence are Phase 4,
 * which will extend this seam; Phase 2 keeps the interface to acquire/isHeld/release.
 */
export interface SessionClaim {
  readonly sessionId: string
  /** Releases this acquisition only. Safe to call more than once. */
  release(): Promise<void>
}

export interface SessionLock {
  /** Try without waiting. A holder can have only one pending or held claim. */
  acquire(sessionId: string): Promise<SessionClaim | null>
  /** Read-only: is the session currently owned (by any tab)? */
  isHeld(sessionId: string): Promise<boolean>
}

export function recordingLockName(sessionId: string): string {
  return `recording:${sessionId}`
}
