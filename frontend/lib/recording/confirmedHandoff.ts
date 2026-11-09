import type { CaptureUploadSuccess } from '@/lib/capture/upload'
import type { SessionPersistence } from './persistence'

// If both writes fail, keep the row out of submission for the rest of this page.
// After reload it can safely reconcile through its original upload intent.
const confirmedInPage = new Map<string, string>()

export function hasConfirmedHandoffInPage(sessionId: string, userId: string): boolean {
  return confirmedInPage.get(sessionId) === userId
}

export async function cleanUpConfirmedHandoff(
  persistence: SessionPersistence,
  sessionId: string,
  userId: string,
  outcome: CaptureUploadSuccess['outcome']
): Promise<void> {
  let marked = false
  try {
    await persistence.patchSession(sessionId, { cleanupOnly: outcome })
    marked = true
  } catch {
    // Deletion can still succeed even if writing the marker failed.
  }
  try {
    await persistence.deleteSession(sessionId)
  } catch {
    if (!marked) confirmedInPage.set(sessionId, userId)
  }
}
