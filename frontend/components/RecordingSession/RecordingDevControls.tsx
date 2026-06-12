"use client"

import {
  MOCK_STATES,
  recordingDevActions,
} from '@/lib/recording/devActions'
import { RECORDING_DEV_CONTROLS_ENABLED } from '@/lib/recording/devMode'

const DEV_SECONDARY_BUTTON_CLASS =
  'rounded-sm border border-ink/20 bg-white/60 px-3 py-1.5 text-xs font-medium text-ink shadow-xs hover:bg-white active:scale-95 dark:border-night-border dark:bg-night-surface/60 dark:text-paper'

export default function RecordingDevControls() {
  if (!RECORDING_DEV_CONTROLS_ENABLED) return null

  return (
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
            recordingDevActions.startMock({ title: 'Demo recording' })
          }
          className="rounded-sm bg-ember-red px-3 py-1.5 text-xs font-medium text-white shadow-xs active:scale-95"
        >
          startMock(&quot;Demo recording&quot;)
        </button>
        {MOCK_STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => recordingDevActions.forceState(s)}
            className={DEV_SECONDARY_BUTTON_CLASS}
          >
            forceState(&quot;{s}&quot;)
          </button>
        ))}
        <button
          type="button"
          onClick={() => recordingDevActions.markError('Mock error message')}
          className={DEV_SECONDARY_BUTTON_CLASS}
        >
          markError
        </button>
        <button
          type="button"
          onClick={() => recordingDevActions.markInterrupted()}
          className={DEV_SECONDARY_BUTTON_CLASS}
        >
          markInterrupted
        </button>
      </div>
    </section>
  )
}
