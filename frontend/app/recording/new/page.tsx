"use client"

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useRecordingActions,
  useRecordingSession,
} from '@/lib/recording/RecordingSessionContext'
import {
  isRemoteRecordingBlocking,
  useRemotePresenceStatus,
} from '@/lib/recording/RemotePresenceContext'
import type { SessionSnapshot } from '@/lib/recording/session'
import { shouldRedirectMissingRecordingSession } from '@/lib/recording/recordingRoute'
import { RECORDING_DEV_CONTROLS_ENABLED } from '@/lib/recording/devMode'
import { MAX_FILE_SIZE_BYTES } from '@/infra/supabase/storage'
import RecordingControls from '@/components/RecordingSession/RecordingControls'
import RecordingDevControls from '@/components/RecordingSession/RecordingDevControls'
import RecordingStateLabel from '@/components/RecordingSession/RecordingStateLabel'
import RecordingTimer from '@/components/RecordingSession/RecordingTimer'
import RecordingWaveform from '@/components/RecordingSession/RecordingWaveform'
import SizeBudgetBanner from '@/components/RecordingSession/SizeBudgetBanner'

const DISCARD_RETRYABLE_UPLOAD_COPY =
  'Leaving this page will discard your recording and you will not be able to retry the upload. Continue?'
const COMPLETION_REDIRECT_DELAY_MS = 600
const COMPLETION_REDIRECT_RETRY_MS = 1_500
const COMPLETION_HARD_FALLBACK_MS = 3_000

function getCompletionRedirectTarget(
  snapshot: Pick<SessionSnapshot, 'state' | 'submissionResult'>
): string | null {
  if (snapshot.state === 'submitted') {
    const result = snapshot.submissionResult
    return result && result.outcome !== 'started'
      ? `/projects?capture=${result.outcome}&projectId=${result.projectId}`
      : '/projects'
  }

  if (snapshot.state === 'discarded') {
    return '/projects'
  }

  return null
}

interface RecordingStatusLayoutProps {
  title: string
  labelClassName?: string
  children: ReactNode
}

function RecordingStatusLayout({
  title,
  labelClassName = 'mt-2 text-sm text-ember-red',
  children,
}: RecordingStatusLayoutProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 pt-24">
      <header>
        <h1 className="font-serif text-3xl text-ink dark:text-paper">
          {title}
        </h1>
        <RecordingStateLabel className={labelClassName} />
      </header>
      {children}
    </div>
  )
}

export default function RecordingNewPage() {
  const router = useRouter()
  const routerRef = useRef(router)
  const snapshot = useRecordingSession()
  const remote = useRemotePresenceStatus()
  const actions = useRecordingActions()
  const [retryingUpload, setRetryingUpload] = useState(false)
  const completionRedirectTarget = getCompletionRedirectTarget({
    state: snapshot.state,
    submissionResult: snapshot.submissionResult,
  })

  useEffect(() => {
    routerRef.current = router
  }, [router])

  // Phase 4: a direct visit here from a non-owner tab (local idle, but another
  // same-browser tab is recording) shows a passive remote state instead of the
  // "no active recording" redirect.
  const isRemoteOnly =
    snapshot.state === 'idle' && isRemoteRecordingBlocking(remote)

  // Phase 3: the unload guard is installed app-level in RecordingSessionProvider so
  // it survives navigation away from this route. In-app navigation (incl. browser
  // back) is always allowed while recording, so there is no route-bound popstate
  // guard here anymore.

  useEffect(() => {
    if (!completionRedirectTarget) return

    const navigate = () => {
      routerRef.current.replace(completionRedirectTarget)
    }
    const primaryId = window.setTimeout(navigate, COMPLETION_REDIRECT_DELAY_MS)
    const retryId = window.setTimeout(navigate, COMPLETION_REDIRECT_RETRY_MS)
    const fallbackId = window.setTimeout(() => {
      try {
        window.location.replace(completionRedirectTarget)
      } catch {
        window.location.href = completionRedirectTarget
      }
    }, COMPLETION_HARD_FALLBACK_MS)

    return () => {
      window.clearTimeout(primaryId)
      window.clearTimeout(retryId)
      window.clearTimeout(fallbackId)
    }
  }, [completionRedirectTarget])

  // Idle here means there's no active session to expand. Recovery is handled by
  // the global modal (RecordingSessionProvider), not this route, so production
  // just sends the user back to the library.
  useEffect(() => {
    if (
      shouldRedirectMissingRecordingSession({
        state: snapshot.state,
        remoteKind: remote.kind,
        devControlsEnabled: RECORDING_DEV_CONTROLS_ENABLED,
      })
    ) {
      router.replace('/projects?capture=recording_session_not_found')
    }
  }, [router, snapshot.state, remote.kind])

  const title =
    snapshot.title ?? snapshot.generatedTitle ?? 'Untitled recording'

  const salvageBanner = snapshot.salvageMessage ? (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-ink/15 bg-warm-highlight px-4 py-2 text-sm text-ink dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
    >
      {snapshot.salvageMessage}
    </div>
  ) : null

  // Passive, persistent durability warning. Recording and roaming stay allowed; this
  // only tells the user a crash/close could lose the recording. Never says "armed".
  const durabilityBanner = !snapshot.durable ? (
    <div
      role="status"
      aria-live="polite"
      data-testid="durability-warning"
      className="rounded-md border border-ink/15 bg-warm-highlight px-4 py-2 text-sm text-ink dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
    >
      If this tab refreshes, closes, or crashes, this recording may be lost.
    </div>
  ) : null

  // Passive capture-health warning when audio stops flowing while still recording.
  const captureHealthBanner = snapshot.captureHealthWarning ? (
    <div
      role="status"
      aria-live="polite"
      data-testid="capture-health-warning"
      className="rounded-md border border-ember-red/40 bg-ember-red/10 px-4 py-2 text-sm text-ink dark:text-paper"
    >
      {snapshot.captureHealthWarning}
    </div>
  ) : null

  const handleRetryUpload = async () => {
    setRetryingUpload(true)
    try {
      await actions.retryFinalizedUpload()
    } finally {
      setRetryingUpload(false)
    }
  }

  const handleReturnToLibrary = () => {
    if (snapshot.canRetryUpload) {
      const ok = window.confirm(DISCARD_RETRYABLE_UPLOAD_COPY)
      if (!ok) return
    }

    actions.resetRecordingSession()
    router.push('/projects')
  }

  if (isRemoteOnly) {
    const remoteTitle =
      remote.kind === 'active' && remote.title ? remote.title : null
    return (
      <div
        className="mx-auto flex max-w-2xl flex-col gap-6 px-8 pt-24"
        data-testid="recording-remote-active"
      >
        <header>
          <h1 className="font-serif text-3xl text-ink dark:text-paper">
            {remoteTitle ?? 'Recording in another tab'}
          </h1>
          <p className="mt-2 text-sm text-ink/60 dark:text-paper/60">
            A recording is in progress in another browser tab.
          </p>
        </header>
        <p className="text-sm text-ink/70 dark:text-paper/70">
          Return to the original tab to pause, stop, or save it. You can&apos;t
          control or start a recording from here while one is active.
        </p>
        <button
          type="button"
          onClick={() => router.push('/projects')}
          className="self-start rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper transition-all hover:shadow-md active:scale-95 dark:bg-paper dark:text-ink"
        >
          Return to library
        </button>
      </div>
    )
  }

  if (snapshot.state === 'idle') {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 pt-24 pb-12">
        <header>
          <h1 className="font-serif text-3xl text-ink dark:text-paper">
            Recording session
          </h1>
          <p className="mt-2 text-sm text-ink/60 dark:text-paper/60">
            No active recording.
          </p>
        </header>

        {RECORDING_DEV_CONTROLS_ENABLED && <RecordingDevControls />}
      </div>
    )
  }

  if (snapshot.state === 'error') {
    return (
      <RecordingStatusLayout title={title}>
        {salvageBanner}
        <div className="rounded-md border border-ember-red/40 bg-ember-red/10 p-4 text-sm text-ink dark:text-paper">
          {snapshot.errorMessage ?? 'Something went wrong with the recording.'}
        </div>
        <div className="flex flex-wrap gap-3">
          {snapshot.canRetryUpload && (
            <button
              type="button"
              onClick={handleRetryUpload}
              disabled={retryingUpload}
              className="rounded-sm bg-ember-red px-4 py-2 text-sm font-medium text-white transition-all hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retryingUpload ? 'Retrying…' : 'Retry upload'}
            </button>
          )}
          <button
            type="button"
            onClick={handleReturnToLibrary}
            className="rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper transition-all hover:shadow-md active:scale-95 dark:bg-paper dark:text-ink"
          >
            Return to library
          </button>
        </div>
      </RecordingStatusLayout>
    )
  }

  if (snapshot.state === 'recoverable') {
    // The blocking recovery modal (RecordingSessionProvider) owns the actions;
    // this route just shows a neutral status beneath it.
    return (
      <RecordingStatusLayout
        title={title}
        labelClassName="mt-2 text-sm text-ink/60 dark:text-paper/60"
      >
        <p className="text-sm text-ink/60 dark:text-paper/60">
          Recovering a previous recording…
        </p>
      </RecordingStatusLayout>
    )
  }

  if (snapshot.state === 'interrupted') {
    return (
      <RecordingStatusLayout title={title}>
        {salvageBanner}
        <p className="text-sm text-ink/70 dark:text-paper/70">
          Your recording was interrupted and couldn&apos;t be recovered.
        </p>
        <button
          type="button"
          onClick={handleReturnToLibrary}
          className="self-start rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper transition-all hover:shadow-md active:scale-95 dark:bg-paper dark:text-ink"
        >
          Return to library
        </button>
      </RecordingStatusLayout>
    )
  }

  if (snapshot.state === 'submitted' || snapshot.state === 'discarded') {
    const target = completionRedirectTarget ?? '/projects'
    return (
      <RecordingStatusLayout
        title={title}
        labelClassName="mt-2 text-sm text-ink/60 dark:text-paper/60"
      >
        {salvageBanner}
        <p className="text-sm text-ink/60 dark:text-paper/60">
          Returning to library…
        </p>
        <a
          href={target}
          className="self-start rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper transition-all hover:shadow-md active:scale-95 dark:bg-paper dark:text-ink"
        >
          Return to library
        </a>
      </RecordingStatusLayout>
    )
  }

  // recording / paused / finalizing / uploading
  const isInFlight =
    snapshot.state === 'finalizing' || snapshot.state === 'uploading'

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 pt-24 pb-12">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-ink dark:text-paper">
            {title}
          </h1>
          <RecordingStateLabel className="mt-2 text-sm text-ember-red" />
        </div>
        <RecordingTimer className="font-mono text-3xl tabular-nums text-ink dark:text-paper" />
      </header>

      <RecordingWaveform />

      <SizeBudgetBanner snapshot={snapshot} maxBytes={MAX_FILE_SIZE_BYTES} />

      {durabilityBanner}

      {captureHealthBanner}

      {salvageBanner}

      {isInFlight ? (
        <div
          className="flex items-center gap-3 text-sm text-ink/60 dark:text-paper/60"
          data-testid="recording-spinner"
        >
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ember-red border-t-transparent" />
          <span>
            {snapshot.state === 'finalizing'
              ? 'Saving recording…'
              : 'Uploading…'}
          </span>
        </div>
      ) : (
        <RecordingControls />
      )}
    </div>
  )
}
