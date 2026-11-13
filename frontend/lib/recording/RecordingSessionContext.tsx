"use client"

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import {
  attachAndStart as attachAndStartAction,
  discard as discardAction,
  discardRecovered as discardRecoveredAction,
  closeRecoveryForAccountChange,
  getServerSnapshot,
  getSnapshot,
  isRecordingSessionActive,
  pause as pauseAction,
  releaseFrozenLiveRecording,
  resetRecordingSession as resetRecordingSessionAction,
  retryFinalizedUpload as retryFinalizedUploadAction,
  resume as resumeAction,
  runRecoveryProbe,
  saveRecovered as saveRecoveredAction,
  stopAndFinalize as stopAndFinalizeAction,
  subscribe,
  updateSessionKeyTerms as updateSessionKeyTermsAction,
  updateSessionTitle as updateSessionTitleAction,
  type AttachAndStartParams,
  type RecordingState,
  type SaveRecoveredResult,
  type SessionSnapshot,
} from './session'
import { isRecordingAccountCurrent, setIdentity } from './sessionIdentity'
import { useBeforeUnloadGuard } from './useBeforeUnloadGuard'
import { useRemotePresence } from './useRemotePresence'
import { RemotePresenceProvider } from './RemotePresenceContext'
import { clearPresenceForSession } from './presence'
import { useAuth } from '@/lib/auth/AuthProvider'
import RecoveryModal from '@/components/RecordingSession/RecoveryModal'
import { toast } from '@/components/ui/toaster'
import { PROJECT_MISSING_WARNING_MESSAGE, showCaptureWarning } from '@/lib/capture/warnings'
import { savedCaptureMessage } from '@/lib/capture/outcomeMessages'
import { AUTO_STOP_MESSAGES, DURATION_WARNING_MESSAGE } from './durationBudget'
export { RecordingAlreadyActiveError } from './session'

interface RecordingActions {
  attachAndStart: (params: AttachAndStartParams) => Promise<void>
  pause: () => void
  resume: () => void
  stopAndFinalize: () => Promise<void>
  retryFinalizedUpload: () => Promise<void>
  discard: () => void
  resetRecordingSession: () => void
  saveRecovered: (title: string, expectedSessionId?: string) => Promise<SaveRecoveredResult>
  discardRecovered: (expectedSessionId?: string) => Promise<void>
  updateSessionTitle: (title: string | null) => void
  updateSessionKeyTerms: (keyTerms: string[]) => void
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
  updateSessionTitle: updateSessionTitleAction,
  updateSessionKeyTerms: updateSessionKeyTermsAction,
}

export function RecordingSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const identity = useAuth()
  const { accountChange, hasStopped } = identity
  const snapshot = useRecordingSession()
  const pathname = usePathname()
  const warnedDurationRef = useRef<number | null>(null)
  const noticedAutoStopRef = useRef<number | null>(null)
  const probedUserRef = useRef<string | null>(null)
  const warnedTranscriptIdRef = useRef<string | null>(null)
  const ownerLossHandledSessionRef = useRef<string | null>(null)
  const [ownerLossRetryTick, setOwnerLossRetryTick] = useState(0)

  // App-level unload guard: warns on refresh/close/quit while a recording is active
  // (through upload completion), on every route — not just `/recording/new`.
  useBeforeUnloadGuard(isRecordingSessionActive(snapshot) || snapshot.uploadPhase !== null)

  const { startedAt, state, durationWarning, autoStopReason } = snapshot
  useEffect(() => {
    if (pathname === '/recording/new' || identity.accountChange || startedAt === null) return

    if (autoStopReason && noticedAutoStopRef.current !== startedAt) {
      noticedAutoStopRef.current = startedAt
      toast({ title: AUTO_STOP_MESSAGES[autoStopReason] })
    } else if (
      durationWarning &&
      (state === 'recording' || state === 'paused') &&
      warnedDurationRef.current !== startedAt
    ) {
      warnedDurationRef.current = startedAt
      toast({ title: 'Recording is nearing the time limit', description: DURATION_WARNING_MESSAGE })
    }
  }, [pathname, identity.accountChange, startedAt, state, durationWarning, autoStopReason])

  useEffect(() => {
    const result = snapshot.submissionResult
    if (
      snapshot.state !== 'submitted' ||
      !result ||
      accountChange ||
      hasStopped?.() ||
      warnedTranscriptIdRef.current === result.transcriptId
    ) {
      return
    }

    warnedTranscriptIdRef.current = result.transcriptId
    if (pathname !== '/recording/new') {
      toast({
        title: result.warning === 'project_missing' ? PROJECT_MISSING_WARNING_MESSAGE : 'Recording saved',
        description: savedCaptureMessage(result.outcome) ?? undefined,
      })
    } else {
      showCaptureWarning(result.warning)
    }
  }, [accountChange, hasStopped, pathname, snapshot.state, snapshot.submissionResult])

  // Phase 4: derive same-browser remote-presence status once, here, and share it
  // via context. `localActive` suppresses remote state when this tab is itself the
  // (resolving) owner of an active or recoverable recording.
  const localActive =
    isRecordingSessionActive(snapshot) || snapshot.state === 'recoverable'
  const remoteStatus = useRemotePresence(localActive)

  // Push the authenticated identity into the recording seam (keeps lib/recording
  // free of any supabase import).
  // Keep this before any recovery-probe effects: runRecoveryProbe reads this seam.
  useLayoutEffect(() => {
    setIdentity({
      userId: identity.userId,
      ready: identity.ready,
      accountChanged: Boolean(identity.accountChange),
      hasStopped: identity.hasStopped,
    })
  }, [identity.userId, identity.ready, identity.accountChange, identity.hasStopped])

  useEffect(() => {
    if (identity.accountChange) {
      closeRecoveryForAccountChange()
      releaseFrozenLiveRecording()
    }
  }, [identity.accountChange])

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
    if (!identity.ready || !identity.userId || identity.accountChange) return
    ownerLossHandledSessionRef.current = lostSessionId
    let cancelled = false
    let retryTimer: number | null = null

    const probeOwnerLoss = async () => {
      try {
        const foundRecoverable = await runRecoveryProbe()
        if (cancelled || !isRecordingAccountCurrent(identity.userId)) return
        if (!foundRecoverable) {
          clearPresenceForSession(lostSessionId)
        }
      } catch {
        // best-effort; clear the marker so a later evaluation can retry this session.
        if (ownerLossHandledSessionRef.current === lostSessionId) {
          ownerLossHandledSessionRef.current = null
        }
        if (!cancelled) {
          retryTimer = window.setTimeout(() => {
            setOwnerLossRetryTick((tick) => tick + 1)
          }, 2_000)
        }
      }
    }

    void probeOwnerLoss()

    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [lostSessionId, identity.ready, identity.userId, identity.accountChange, ownerLossRetryTick])

  // App-wide recovery probe: runs once per resolved user. Recovery is surfaced via
  // the blocking modal below (and attachAndStart re-probes as a backstop before any
  // new recording starts), so the probe never gates app rendering.
  useEffect(() => {
    if (!identity.ready || identity.accountChange) return

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
  }, [identity.ready, identity.userId, identity.accountChange])

  const recoverable =
    snapshot.state === 'recoverable' && identity.ready && identity.userId && !identity.accountChange
      ? snapshot.recoverable
      : null

  return (
    <RemotePresenceProvider value={remoteStatus}>
      {children}
      {recoverable && (
        <RecoveryModal
          key={recoverable.sessionId}
          info={recoverable}
          previousSave={snapshot.submissionResult}
          uploadPhase={snapshot.uploadPhase}
          uploadBytes={snapshot.uploadBytes}
        />
      )}
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
