"use client"

import {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { LiveAudioVisualizer } from '@/components/RecordingSession/LiveAudioVisualizer'
import { useRecordingState } from '@/lib/recording/RecordingSessionContext'
import { getLiveRecorder } from '@/lib/recording/session'
import type { RecordingState } from '@/lib/recording/session'
import RecordingWaveformMock from './RecordingWaveformMock'

// Matches `--color-ember-red: #C73E1D` from app/globals.css.
const EMBER_RED = 'rgb(199, 62, 29)'
// Matches the `h-32` container height (8rem = 128px).
const WAVE_HEIGHT = 128
// Mirror Waveform.tsx's BAR_WIDTH_PX / BAR_GAP_PX for visual consistency.
const BAR_WIDTH = 6
const BAR_GAP = 4

const CONTAINER_CLASS =
  'flex h-32 w-full items-center justify-center overflow-hidden'

function hasAudioContext(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(
    window.AudioContext ||
      (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext
  )
}

// Errors thrown while the visualizer builds its audio graph (e.g. AudioContext
// or createMediaStreamSource failing) bubble to this boundary, which swaps in
// the animated mock. The `hasAudioContext` guard handles the common
// "unsupported browser" case during render; this is the secondary net.
class WaveformErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function LiveWaveform({
  recorder,
  state,
}: {
  recorder: MediaRecorder
  state: RecordingState
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // The visualizer draws to a canvas sized in device pixels, so feed it the
  // measured container width rather than a hardcoded value (a fixed width
  // renders blurry / mis-sized). Re-measure on resize.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      data-testid="recording-waveform"
      data-state={state}
      className={CONTAINER_CLASS}
    >
      {width > 0 && (
        <LiveAudioVisualizer
          mediaRecorder={recorder}
          width={width}
          height={WAVE_HEIGHT}
          barWidth={BAR_WIDTH}
          gap={BAR_GAP}
          barColor={EMBER_RED}
          backgroundColor="transparent"
        />
      )}
    </div>
  )
}

export default function RecordingWaveform() {
  // Subscribing to the session state re-renders this wrapper on pause/resume so
  // the live visualizer sees `mediaRecorder.state` flip and freezes/restarts.
  const state = useRecordingState()

  // The recorder only exists while audio is being captured. For finalizing /
  // uploading (and idle/error/etc.) there is no live recorder, so we render the
  // frozen mock — preserving the existing page behavior and test assertions.
  const recorder =
    state === 'recording' || state === 'paused' ? getLiveRecorder() : null

  if (!recorder || !hasAudioContext()) {
    return <RecordingWaveformMock />
  }

  return (
    <WaveformErrorBoundary fallback={<RecordingWaveformMock />}>
      <LiveWaveform recorder={recorder} state={state} />
    </WaveformErrorBoundary>
  )
}
