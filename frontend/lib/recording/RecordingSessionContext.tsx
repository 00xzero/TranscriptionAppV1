"use client"

import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  attachAndStart as attachAndStartAction,
  discard as discardAction,
  discardRecovered as discardRecoveredAction,
  getServerSnapshot,
  getSnapshot,
  isRecordingSessionActive,
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
import { useBeforeUnloadGuard } from './useBeforeUnloadGuard'
import { useRemotePresence } from './useRemotePresence'
import { RemotePresenceProvider } from './RemotePresenceContext'
import { clearPresenceForSession } from './presence'
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
  const ownerLossHandledSessionRef = useRef<string | null>(null)

  // App-level unload guard: warns on refresh/close/quit while a recording is active
  // (through upload completion), on every route — not just `/recording/new`.
  useBeforeUnloadGuard(isRecordingSessionActive(snapshot))

  // Phase 4: derive same-browser remote-presence status once, here, and share it
  // via context. `localActive` suppresses remote state when this tab is itself the
  // (resolving) owner of an active or recoverable recording.
  const localActive =
    isRecordingSessionActive(snapshot) || snapshot.state === 'recoverable'
  const remoteStatus = useRemotePresence(localActive)

  // Push the authenticated identity into the recording seam (keeps lib/recording
  // free of any supabase import) and defensively patch any live persisted row.
  // Keep this before any recovery-probe effects: runRecoveryProbe reads this seam.
  useEffect(() => {
    setIdentity({ userId: identity.userId, ready: identity.ready })
    if (identity.ready && identity.userId) {
      syncIdentityToActiveSession(identity.userId)
    }
  }, [identity.userId, identity.ready])

  // Single owner-loss side effect: when a same-user recording loses its owner tab,
  // probe once for recoverable chunks. The probe hydrates `recoverable` (surfacing
  // the blocking modal below) when valid audio exists; otherwise the dead
  // presence snapshot is cleared so new tabs do not keep rediscovering it. De-dupe
  // is scoped to the lost sessionId so a *different* orphan still triggers a
  // probe, and a failed probe clears the marker so it can retry.
  const lostSessionId =
    remoteStatus.kind === 'owner-lost' ? remoteStatus.sessionId : null
  useEffect(() => {
    if (!lostSessionId) {
      ownerLossHandledSessionRef.current = null
      return
    }
    if (ownerLossHandledSessionRef.current === lostSessionId) return
    if (!identity.ready || !identity.userId) return
    ownerLossHandledSessionRef.current = lostSessionId
    void runRecoveryProbe()
      .then((foundRecoverable) => {
        if (!foundRecoverable) {
          clearPresenceForSession(lostSessionId)
        }
      })
      .catch(() => {
        // best-effort; clear the marker so a later evaluation can retry this session.
        if (ownerLossHandledSessionRef.current === lostSessionId) {
          ownerLossHandledSessionRef.current = null
        }
      })
  }, [lostSessionId, identity.ready, identity.userId])

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
    <RemotePresenceProvider value={remoteStatus}>
      {children}
      {recoverable && <RecoveryModal info={recoverable} />}
    </RemotePresenceProvider>
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
