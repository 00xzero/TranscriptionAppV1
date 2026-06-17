"use client"

import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  attachAndStart as attachAndStartAction,
  discard as discardAction,
  discardRecovered as discardRecoveredAction,
  getServerSnapshot,
  getSnapshot,
  pause as pauseAction,
  resetRecordingSession as resetRecordingSessionAction,
  retryFinalizedUpload as retryFinalizedUploadAction,
  resume as resumeAction,
  runRecoveryProbe,
  saveRecovered as saveRecoveredAction,
  stopAndFinalize as stopAndFinalizeAction,
  subscribe,
  syncIdentityToActiveSession,
  type AttachAndStartParams,
  type RecordingState,
  type SaveRecoveredResult,
  type SessionSnapshot,
} from './session'
import { setIdentity } from './sessionIdentity'
import { useAuthIdentity } from '@/lib/supabase/hooks'
import RecoveryModal from '@/components/RecordingSession/RecoveryModal'
export { RecordingAlreadyActiveError } from './session'

interface RecordingActions {
  attachAndStart: (params: AttachAndStartParams) => Promise<void>
  pause: () => void
  resume: () => void
  stopAndFinalize: () => Promise<void>
  retryFinalizedUpload: () => Promise<void>
  discard: () => void
  resetRecordingSession: () => void
  saveRecovered: (title: string) => Promise<SaveRecoveredResult>
  discardRecovered: () => Promise<void>
}

const actions: RecordingActions = {
  attachAndStart: attachAndStartAction,
  pause: pauseAction,
  resume: resumeAction,
  stopAndFinalize: stopAndFinalizeAction,
  retryFinalizedUpload: retryFinalizedUploadAction,
  discard: discardAction,
  resetRecordingSession: resetRecordingSessionAction,
  saveRecovered: saveRecoveredAction,
  discardRecovered: discardRecoveredAction,
}

export function RecordingSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const identity = useAuthIdentity()
  const snapshot = useRecordingSession()
  const probedUserRef = useRef<string | null>(null)

  // Push the authenticated identity into the recording seam (keeps lib/recording
  // free of any supabase import) and defensively patch any live persisted row.
  useEffect(() => {
    setIdentity({ userId: identity.userId, ready: identity.ready })
    if (identity.ready && identity.userId) {
      syncIdentityToActiveSession(identity.userId)
    }
  }, [identity.userId, identity.ready])

  // App-wide recovery probe: runs once per resolved user. Recovery is surfaced via
  // the blocking modal below (and attachAndStart re-probes as a backstop before any
  // new recording starts), so the probe never gates app rendering.
  useEffect(() => {
    if (!identity.ready) return

    if (!identity.userId) {
      probedUserRef.current = null
      return
    }

    if (probedUserRef.current === identity.userId) return

    let cancelled = false
    const userId = identity.userId
    void runRecoveryProbe()
      .catch(() => {
        // Recovery is best-effort; never hard-block on a probe failure.
      })
      .finally(() => {
        if (!cancelled) probedUserRef.current = userId
      })

    return () => {
      cancelled = true
    }
  }, [identity.ready, identity.userId])

  const recoverable =
    snapshot.state === 'recoverable' ? snapshot.recoverable : null

  return (
    <>
      {children}
      {recoverable && <RecoveryModal info={recoverable} />}
    </>
  )
}

export function useRecordingSession(): SessionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useRecordingState(): RecordingState {
  return useRecordingSession().state
}

export function useRecordingActions(): RecordingActions {
  return actions
}
