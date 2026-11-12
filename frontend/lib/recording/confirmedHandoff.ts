import type { CaptureUploadOutcome } from '@/contracts/capture'
import type { SessionPersistence, SessionWriteQueue } from './persistence'
import { waitForLocalCleanup } from './cleanupDeadline'

// If local storage cannot confirm either write, keep the row out of submission
// for the rest of this page.
// After reload it can safely reconcile through its original upload intent.
const confirmedInPage = new Map<string, string>()

export function hasConfirmedHandoffInPage(sessionId: string, userId: string): boolean {
  return confirmedInPage.get(sessionId) === userId
}

export async function cleanUpConfirmedHandoff(
  persistence: SessionPersistence,
  sessionId: string,
  userId: string,
  outcome: CaptureUploadOutcome,
  queue?: SessionWriteQueue | null
): Promise<boolean> {
  confirmedInPage.set(sessionId, userId)
  return waitForLocalCleanup(async (signal) => {
    await queue?.seal(signal)
    if (signal.aborted) return
    try {
      await persistence.patchSession(sessionId, { cleanupOnly: outcome }, signal)
      confirmedInPage.delete(sessionId)
    } catch {
      // Deletion can still succeed even if writing the marker failed.
    }
    if (signal.aborted) return
    try {
      await persistence.deleteSession(sessionId, () => !signal.aborted)
      confirmedInPage.delete(sessionId)
    } catch {
      // A later probe can retry cleanup under a new claim.
    }
  })
}
