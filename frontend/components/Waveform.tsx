'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { formatClockTime } from '@/lib/utils'
import { useScrubGesture, type ScrubEndHandler } from '@/lib/audio/useScrubGesture'

interface WaveformProps {
  /** Source peaks (length 2048 from the artifact), values in [0, 1]. */
  peaks: number[]
  /** Current playback time in seconds. */
  currentTime: number
  /** Total duration in seconds. */
  duration: number
  /** Plain seek for pointer taps/presses and keyboard navigation. */
  onSeek?: (fraction: number) => void
  onSeekStart?: () => void
  onSeekEnd?: ScrubEndHandler
  /** Drag preview, called after onScrubStart. */
  onScrub?: (fraction: number) => void
  interactive?: boolean
  sourceKey?: string | null
  /** Called when the user begins a drag-scrub gesture. */
  onScrubStart?: () => void
  /** Called once when a drag is released, cancelled or torn down. */
  onScrubEnd?: ScrubEndHandler
}

const MIN_BARS = 80
const MAX_BARS = 280
const BAR_WIDTH_PX = 6
const BAR_GAP_PX = 4
const PX_PER_BAR = BAR_WIDTH_PX + BAR_GAP_PX
const MIN_BAR_HEIGHT_PCT = 6
const RULER_TICK_COUNT = 5

function clampFraction(f: number): number {
  if (!Number.isFinite(f)) return 0
  return Math.max(0, Math.min(1, f))
}

function downsamplePeaks(source: number[], targetBars: number): number[] {
  if (targetBars <= 0 || source.length === 0) return []
  if (source.length === targetBars) return source.slice()

  const out = new Array<number>(targetBars)
  const ratio = source.length / targetBars
  let cursor = 0
  for (let i = 0; i < targetBars; i++) {
    const start = cursor
    const end = Math.min(source.length, cursor + ratio)
    const startIdx = Math.floor(start)
    const endIdx = Math.min(source.length, Math.ceil(end))
    let max = 0
    for (let j = startIdx; j < endIdx; j++) {
      const v = source[j]
      if (v > max) max = v
    }
    out[i] = max
    cursor = end
  }
  return out
}

export default function Waveform({
  peaks,
  currentTime,
  duration,
  onSeek,
  onSeekStart,
  onSeekEnd,
  onScrub,
  interactive = true,
  sourceKey,
  onScrubStart,
  onScrubEnd,
}: WaveformProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const scrub = useScrubGesture({
    duration, fraction: duration > 0 ? currentTime / duration : 0,
    interactive, sourceKey, onSeek, onSeekStart, onSeekEnd, onScrub, onScrubStart, onScrubEnd,
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => setWidth(next), 100)
    })
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => {
      ro.disconnect()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  const barCount = useMemo(() => {
    if (width <= 0) return MIN_BARS
    return Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(width / PX_PER_BAR)))
  }, [width])

  const displayBars = useMemo(() => {
    const sampled = downsamplePeaks(peaks, barCount)
    // Normalize against the loudest bar so quiet recordings still get strong
    // height variation; raw peaks of ~0.1–0.5 would render as a flat band.
    let max = 0
    for (let i = 0; i < sampled.length; i++) if (sampled[i] > max) max = sampled[i]
    if (max <= 0) return sampled
    for (let i = 0; i < sampled.length; i++) sampled[i] = sampled[i] / max
    return sampled
  }, [peaks, barCount])

  const rulerTicks = useMemo(() => {
    if (!Number.isFinite(duration) || duration <= 0) return []
    return Array.from({ length: RULER_TICK_COUNT }, (_, i) =>
      (i * duration) / (RULER_TICK_COUNT - 1)
    )
  }, [duration])

  // Drive the active-region clip via a CSS variable so React doesn't reconcile
  // the bar grids on every timeupdate tick.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const fraction = scrub.previewFraction ?? (duration > 0 ? clampFraction(currentTime / duration) : 0)
    el.style.setProperty('--waveform-progress', `${(fraction * 100).toFixed(2)}%`)
  }, [currentTime, duration, scrub.previewFraction])

  return (
    <div
      data-testid="waveform-bars"
      ref={containerRef}
      role="slider"
      {...scrub.sliderProps}
      aria-valuenow={scrub.sliderProps['aria-valuenow']}
      aria-label="Audio waveform"
      className="relative w-full cursor-pointer select-none outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trust-blue data-[scrub-pointer-focus=true]:focus-visible:outline-none"
      style={{ touchAction: 'pan-y pinch-zoom', ['--waveform-progress' as string]: '0%' }}
    >
      <div className="relative h-40 w-full">
        <BarLayer
          bars={displayBars}
          className="absolute inset-0 flex items-center justify-center gap-1 text-ink/20 dark:text-night-border"
        />
        <div
          className="absolute inset-0 overflow-hidden pointer-events-none"
          style={{ clipPath: 'inset(0 calc(100% - var(--waveform-progress)) 0 0)' }}
        >
          <BarLayer
            bars={displayBars}
            className="absolute inset-0 flex items-center justify-center gap-1 text-trust-blue"
          />
        </div>
        <div
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-trust-blue shadow-glow pointer-events-none -translate-x-1/2 z-20"
          style={{ left: 'var(--waveform-progress)' }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-trust-blue rounded-full" />
        </div>
      </div>
      {rulerTicks.length > 0 && (
        <div aria-hidden className="flex justify-between mt-4 mb-3 text-[10px] font-mono text-ink/40 dark:text-paper/30 px-2">
          {rulerTicks.map((t, i) => (
            <span key={i}>{formatClockTime(t)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

interface BarLayerProps {
  bars: number[]
  className: string
}

const BarLayer = React.memo(function BarLayer({ bars, className }: BarLayerProps) {
  return (
    <div className={className}>
      {bars.map((height, i) => (
        <span
          key={i}
          className="bg-current rounded-full shrink-0"
          style={{
            // Floor keeps silent regions faintly visible.
            height: `${Math.max(MIN_BAR_HEIGHT_PCT, height * 100)}%`,
            width: `${BAR_WIDTH_PX}px`,
          }}
        />
      ))}
    </div>
  )
})
