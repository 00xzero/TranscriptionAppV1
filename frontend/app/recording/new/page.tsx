"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  useRecordingActions,
  useRecordingSession,
} from '@/lib/recording/RecordingSessionContext'
import type { RecordingState } from '@/lib/recording/session'
import RecordingControls from '@/components/RecordingSession/RecordingControls'
import RecordingStateLabel from '@/components/RecordingSession/RecordingStateLabel'
import RecordingTimer from '@/components/RecordingSession/RecordingTimer'
import RecordingWaveformMock from '@/components/RecordingSession/RecordingWaveformMock'

const IS_DEV = process.env.NODE_ENV !== 'production'

const MOCK_STATES: RecordingState[] = [
  'recording',
  'paused',
  'finalizing',
  'uploading',
  'submitted',
  'discarded',
  'error',
  'interrupted',
]

export default function RecordingNewPage() {
  const router = useRouter()
  const snapshot = useRecordingSession()
  const actions = useRecordingActions()

  useEffect(() => {
    if (snapshot.state === 'submitted' || snapshot.state === 'discarded') {
      const id = window.setTimeout(() => {
        router.replace('/projects')
      }, 600)
      return () => window.clearTimeout(id)
    }
  }, [snapshot.state, router])

  useEffect(() => {
    if (snapshot.state !== 'idle') return

    if (!actions.recoverInterruptedMock() && !IS_DEV) {
      router.replace('/projects?capture=recording_session_not_found')
    }
  }, [actions, router, snapshot.state])

  const title = snapshot.title ?? 'Untitled recording'

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

        {IS_DEV && (
          <section
            data-testid="recording-dev-controls"
            className="rounded-md border border-dashed border-ink/20 bg-paper/50 p-6 dark:border-night-border dark:bg-night-surface/40"
          >
            <h2 className="mb-4 font-mono text-xs uppercase tracking-wider text-ink/50 dark:text-paper/50">
              Dev controls — mock state
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  actions.startMock({ title: 'Demo recording' })
                }
                className="rounded-sm bg-ember-red px-3 py-1.5 text-xs font-medium text-white shadow-xs active:scale-95"
              >
                startMock(&quot;Demo recording&quot;)
              </button>
              {MOCK_STATES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => actions.forceState(s)}
                  className="rounded-sm border border-ink/20 bg-white/60 px-3 py-1.5 text-xs font-medium text-ink shadow-xs hover:bg-white active:scale-95 dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
                >
                  forceState({s})
                </button>
              ))}
              <button
                type="button"
                onClick={() => actions.markError('Mock error message')}
                className="rounded-sm border border-ink/20 bg-white/60 px-3 py-1.5 text-xs font-medium text-ink shadow-xs hover:bg-white active:scale-95 dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
              >
                markError
              </button>
              <button
                type="button"
                onClick={() => actions.markInterrupted()}
                className="rounded-sm border border-ink/20 bg-white/60 px-3 py-1.5 text-xs font-medium text-ink shadow-xs hover:bg-white active:scale-95 dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
              >
                markInterrupted
              </button>
            </div>
          </section>
        )}
      </div>
    )
  }

  if (snapshot.state === 'error') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 pt-24">
        <header>
          <h1 className="font-serif text-3xl text-ink dark:text-paper">
            {title}
          </h1>
          <RecordingStateLabel className="mt-2 text-sm text-ember-red" />
        </header>
        <div className="rounded-md border border-ember-red/40 bg-ember-red/10 p-4 text-sm text-ink dark:text-paper">
          {snapshot.errorMessage ?? 'Something went wrong with the recording.'}
        </div>
        <button
          type="button"
          onClick={() => {
            actions.resetMock()
            router.push('/projects')
          }}
          className="self-start rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper transition-all hover:shadow-md active:scale-95 dark:bg-paper dark:text-ink"
        >
          Return to library
        </button>
      </div>
    )
  }

  if (snapshot.state === 'interrupted') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 pt-24">
        <header>
          <h1 className="font-serif text-3xl text-ink dark:text-paper">
            {title}
          </h1>
          <RecordingStateLabel className="mt-2 text-sm text-ember-red" />
        </header>
        <p className="text-sm text-ink/70 dark:text-paper/70">
          Your recording was interrupted and could not be recovered.
        </p>
        <button
          type="button"
          onClick={() => actions.startMock({ title: snapshot.title })}
          className="self-start rounded-sm bg-ember-red px-4 py-2 text-sm font-medium text-white transition-all hover:shadow-md active:scale-95"
        >
          Start a new recording
        </button>
      </div>
    )
  }

  if (snapshot.state === 'submitted' || snapshot.state === 'discarded') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 pt-24">
        <header>
          <h1 className="font-serif text-3xl text-ink dark:text-paper">
            {title}
          </h1>
          <RecordingStateLabel className="mt-2 text-sm text-ink/60 dark:text-paper/60" />
        </header>
        <p className="text-sm text-ink/60 dark:text-paper/60">
          Returning to library…
        </p>
      </div>
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

      <RecordingWaveformMock />

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
