"use client"

import {
  MOCK_STATES,
  recordingDevActions,
} from '@/lib/recording/devActions'
import { RECORDING_DEV_CONTROLS_ENABLED } from '@/lib/recording/devMode'
import { Button } from '@/components/ui/button'

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
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() =>
            recordingDevActions.startMock({ title: 'Demo recording' })
          }
        >
          startMock(&quot;Demo recording&quot;)
        </Button>
        {MOCK_STATES.map((s) => (
          <Button
            key={s}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => recordingDevActions.forceState(s)}
          >
            forceState(&quot;{s}&quot;)
          </Button>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => recordingDevActions.markError('Mock error message')}
        >
          markError
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => recordingDevActions.markInterrupted()}
        >
          markInterrupted
        </Button>
      </div>
    </section>
  )
}
