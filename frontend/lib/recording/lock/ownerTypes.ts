/**
 * Global per-browser recording mutex (Phase 4).
 *
 * Distinct from `SessionLock` (which is per recording session). The owner lock
 * answers one question: "is ANY tab in this browser currently the live recording
 * owner?" The owning tab holds it for the whole active lifecycle
 * (recording → uploading) so a second tab cannot start a duplicate recording.
 *
 * There is exactly one owner lock name per browser profile — it carries no
 * sessionId. A holder holds it at most once at a time.
 */
export interface BrowserOwnerLock {
  /**
   * Try to become the browser's recording owner. Resolves to `false` (without
   * blocking) when another tab already owns it — this is what blocks a duplicate
   * start race-free.
   */
  acquire(): Promise<boolean>
  /** Read-only: is some tab currently the recording owner? */
  isHeld(): Promise<boolean>
  /** Release ownership if this holder owns it (no-op otherwise). */
  release(): Promise<void>
}

/** Fixed Web Lock name for the per-browser recording owner. */
export const OWNER_LOCK_NAME = 'recording:owner'
