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
export interface SessionLock {
  /**
   * Try to take ownership of `sessionId`. Returns false (without blocking) when
   * the lock is already held by another holder — this is what makes recovery a
   * race-free claim. A holder may hold at most one session lock at a time.
   */
  acquire(sessionId: string): Promise<boolean>
  /** Read-only: is the session currently owned (by any tab)? */
  isHeld(sessionId: string): Promise<boolean>
  /** Release the lock this holder currently owns (no-op if none). */
  release(): Promise<void>
}

export function recordingLockName(sessionId: string): string {
  return `recording:${sessionId}`
}
