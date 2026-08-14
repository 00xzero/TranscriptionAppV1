"use client"

import { useEffect, useRef, useState } from 'react'
import { useRecordingSession } from '@/lib/recording/RecordingSessionContext'
import {
  isRemoteRecordingBlocking,
  useRemotePresenceStatus,
} from '@/lib/recording/RemotePresenceContext'
import { useGuardedNavigate } from '@/lib/recording/guardedNavigation'
import { getElapsedActiveMs } from '@/lib/recording/session'
import type { RecordingState } from '@/lib/recording/session'
import { formatElapsedTime } from '@/lib/recording/timeUtils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const PILL_STATES: ReadonlySet<RecordingState> = new Set<RecordingState>([
  'recording',
  'paused',
  'finalizing',
  'uploading',
  'error',
  'recoverable',
])

const TERMINAL_PILL_MS = 2_200
const DURABILITY_WARNING =
  'If this tab refreshes, closes, or crashes, this recording may be lost.'

type TerminalPill = {
  kind: 'saved' | 'discarded'
  key: number
}

interface PreviewContentProps {
  title: string
  status: string
  detail?: string
  action: string
  warning?: string | null
}

function titleForPreview(snapshot: ReturnType<typeof useRecordingSession>): string {
  return snapshot.title ?? snapshot.generatedTitle ?? 'Untitled recording'
}

function PreviewContent({
  title,
  status,
  detail,
  action,
  warning,
}: PreviewContentProps) {
  return (
    <div className="max-w-72 space-y-2 text-left">
      <div>
        <p className="font-sans text-sm font-medium text-ink dark:text-paper">
          {title}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-ink/60 dark:text-paper/60">
          {status}
        </p>
      </div>
      {detail && (
        <p className="font-sans text-xs leading-relaxed text-ink/70 dark:text-paper/70">
          {detail}
        </p>
      )}
      {warning && (
        <p className="rounded-sm border border-ember-red/30 bg-ember-red/10 px-2 py-1.5 font-sans text-xs leading-relaxed text-ink dark:text-paper">
          {warning}
        </p>
      )}
      <p className="font-sans text-xs leading-relaxed text-ink/60 dark:text-paper/60">
        {action}
      </p>
    </div>
  )
}

function TerminalStatusPill({ terminal }: { terminal: TerminalPill }) {
  const isSaved = terminal.kind === 'saved'
  return (
    <div
      key={terminal.key}
      role="status"
      aria-live="polite"
      data-testid="recording-pill-terminal"
      className={`inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-xs transition-all motion-safe:animate-[fadeIn_150ms_ease-out] ${
        isSaved
          ? 'border-trust-blue/35 bg-trust-blue/10 text-trust-blue dark:bg-trust-blue/15 dark:text-paper'
          : 'border-border bg-surface text-ink/60 dark:bg-night-surface dark:text-paper/60'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          isSaved ? 'bg-trust-blue' : 'bg-ink/35 dark:bg-paper/35'
        }`}
        aria-hidden="true"
      />
      <span className="font-mono">{isSaved ? 'Saved' : 'Discarded'}</span>
    </div>
  )
}

export default function RecordingPill() {
  const guardedNav = useGuardedNavigate()
  const snapshot = useRecordingSession()
  const remote = useRemotePresenceStatus()
  const [terminal, setTerminal] = useState<TerminalPill | null>(null)
  const state = snapshot.state
  const isLocalPillState = PILL_STATES.has(state)
  const previousStateRef = useRef<RecordingState>(state)

  useEffect(() => {
    const previousState = previousStateRef.current
    const reachedTerminal =
      state === 'submitted' || state === 'discarded'
    const cameFromActiveSession =
      previousState !== state &&
      previousState !== 'idle' &&
      previousState !== 'submitted' &&
      previousState !== 'discarded'

    if (reachedTerminal && cameFromActiveSession) {
      const timeoutId = window.setTimeout(() => {
        setTerminal({
          kind: state === 'submitted' ? 'saved' : 'discarded',
          key: Date.now(),
        })
      }, 0)
      previousStateRef.current = state
      return () => window.clearTimeout(timeoutId)
    }

    previousStateRef.current = state
    return undefined
  }, [state])

  useEffect(() => {
    if (!terminal) return

    const timeoutId = window.setTimeout(() => {
      setTerminal(null)
    }, TERMINAL_PILL_MS)

    return () => window.clearTimeout(timeoutId)
  }, [terminal])

  const remoteBlocking = isRemoteRecordingBlocking(remote)

  if (!isLocalPillState && remoteBlocking) {
    const remoteTitle =
      remote.kind === 'active' && remote.title
        ? remote.title
        : 'Recording in another tab'
    const remoteStatus =
      remote.kind === 'active'
        ? remote.state === 'paused'
          ? 'Paused in another tab'
          : 'Recording in another tab'
        : 'Recording ownership is being checked'

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => guardedNav.push('/recording/new')}
            aria-label="A recording is in progress in another tab"
            data-testid="recording-pill-remote"
            className="inline-flex min-w-0 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink/70 shadow-xs transition-all hover:bg-paper hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/35 active:scale-95 dark:bg-night-surface dark:text-paper/70 dark:hover:bg-night-surface/80"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-ink/40 dark:bg-paper/40"
              aria-hidden="true"
            />
            <span className="truncate font-mono">Recording in another tab</span>
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>
          <PreviewContent
            title={remoteTitle}
            status={remoteStatus}
            detail="This tab cannot pause, stop, or save the active recorder."
            action="Open the recording page to see the remote status."
          />
        </TooltipContent>
      </Tooltip>
    )
  }

  if (!isLocalPillState) {
    return terminal ? <TerminalStatusPill terminal={terminal} /> : null
  }

  if (state === 'error' && !snapshot.canRetryUpload) {
    return terminal ? <TerminalStatusPill terminal={terminal} /> : null
  }

  const elapsed = formatElapsedTime(getElapsedActiveMs(snapshot))
  const title = titleForPreview(snapshot)
  const isRecording = state === 'recording'

  let label: string
  let ariaLabel: string
  let status: string
  let detail: string | undefined
  let action = 'Open the recording page.'
  let toneClass =
    'border-border bg-surface text-ink hover:bg-paper dark:bg-night-surface dark:text-paper dark:hover:bg-night-surface/80'
  let dotClass = 'bg-ember-red'

  if (state === 'recording') {
    label = `Recording ${elapsed}`
    ariaLabel = `Return to recording session, recording for ${elapsed}`
    status = `Recording ${elapsed}`
    detail = 'The recorder is active in this tab.'
  } else if (state === 'paused') {
    label = `Paused ${elapsed}`
    ariaLabel = `Return to paused recording session, elapsed time ${elapsed}`
    status = `Paused ${elapsed}`
    detail = 'The recorder is paused in this tab.'
    dotClass = 'bg-trust-blue'
  } else if (state === 'finalizing') {
    label = 'Finalizing...'
    ariaLabel = 'Return to recording session, finalizing'
    status = 'Finalizing'
    detail = 'The final audio file is being prepared.'
    dotClass = 'bg-trust-blue animate-spin'
  } else if (state === 'uploading') {
    label = 'Uploading...'
    ariaLabel = 'Return to recording session, uploading'
    status = 'Uploading'
    detail = 'The recording is being saved for transcription.'
    dotClass = 'bg-trust-blue animate-pulse'
  } else if (state === 'error') {
    label = 'Recording error'
    ariaLabel = 'Return to recording session, upload needs attention'
    status = 'Upload needs attention'
    detail =
      snapshot.errorMessage ??
      'The finalized recording is still available to retry or discard.'
    action = 'Open the recording page to retry or discard it.'
    toneClass = 'border-ember-red/50 bg-ember-red/10 text-ember-red dark:bg-ember-red/15'
    dotClass = 'bg-ember-red'
  } else {
    label = 'Recovered recording'
    ariaLabel = 'Return to recovered recording'
    status = 'Recovered recording'
    detail = 'A previous recording must be saved or discarded.'
    action = 'Open the recording page to resolve it.'
    toneClass = 'border-ember-red/50 bg-ember-red/10 text-ember-red dark:bg-ember-red/15'
    dotClass = 'bg-ember-red'
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => guardedNav.push('/recording/new')}
          aria-label={ariaLabel}
          data-testid="recording-pill"
          className={`inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-xs transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/35 active:scale-95 ${toneClass}`}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${dotClass} ${isRecording ? 'animate-pulse' : ''}`}
            aria-hidden="true"
          />
          <span className="truncate font-mono">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={8}>
        <PreviewContent
          title={title}
          status={status}
          detail={detail}
          action={action}
          warning={!snapshot.durable ? DURABILITY_WARNING : null}
        />
      </TooltipContent>
    </Tooltip>
  )
}
