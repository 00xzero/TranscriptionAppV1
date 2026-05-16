"use client"

import { useRecordingState } from '@/lib/recording/RecordingSessionContext'

const BAR_COUNT = 48

export default function RecordingWaveformMock() {
  const state = useRecordingState()
  const paused = state === 'paused'

  return (
    <div
      data-testid="recording-waveform-mock"
      data-state={state}
      className="flex h-32 w-full items-center justify-center gap-[3px] rounded-md border border-[#D1CEC5] bg-paper/30 px-4 dark:border-night-border dark:bg-night-surface/40"
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <span
          key={i}
          className="block w-[3px] rounded-full bg-ember-red/70"
          style={{
            height: '24px',
            animation: 'recording-bar-pulse 1.2s ease-in-out infinite',
            animationDelay: `${(i % 8) * 90}ms`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      ))}
      <style jsx>{`
        @keyframes recording-bar-pulse {
          0%,
          100% {
            transform: scaleY(0.3);
          }
          50% {
            transform: scaleY(1);
          }
        }
      `}</style>
    </div>
  )
}
