'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatClockTime } from '@/lib/utils'

interface WaveformProps {
  /** Source peaks (length 2048 from the artifact), values in [0, 1]. */
  peaks: number[]
  /** Current playback time in seconds. */
  currentTime: number
  /** Total duration in seconds. */
  duration: number
  /** Called with a fraction in [0, 1] when the user clicks/drags to seek. */
  onScrub?: (fraction: number) => void
  /** Called when the user begins a drag-scrub gesture. */
  onScrubStart?: () => void
  /** Called when the user releases a drag-scrub gesture. */
  onScrubEnd?: () => void
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
  onScrub,
  onScrubStart,
  onScrubEnd,
}: WaveformProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

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
    const fraction = duration > 0 ? clampFraction(currentTime / duration) : 0
    el.style.setProperty('--waveform-progress', `${(fraction * 100).toFixed(2)}%`)
  }, [currentTime, duration])

  const fractionFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (!rect.width) return 0
    return clampFraction((clientX - rect.left) / rect.width)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onScrub) return
    setIsDragging(true)
    onScrubStart?.()
    onScrub(fractionFromClientX(e.clientX))
  }, [onScrub, onScrubStart, fractionFromClientX])

  useEffect(() => {
    if (!isDragging) return
    const handleMove = (e: MouseEvent) => {
      onScrub?.(fractionFromClientX(e.clientX))
    }
    const handleUp = () => {
      setIsDragging(false)
      onScrubEnd?.()
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging, onScrub, onScrubEnd, fractionFromClientX])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onScrub) return
    const fraction = duration > 0 ? clampFraction(currentTime / duration) : 0
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault()
        onScrub(clampFraction(fraction - 0.05))
        break
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault()
        onScrub(clampFraction(fraction + 0.05))
        break
      case 'Home':
        e.preventDefault()
        onScrub(0)
        break
      case 'End':
        e.preventDefault()
        onScrub(1)
        break
      default:
        break
    }
  }, [onScrub, currentTime, duration])

  const rawAriaValueNow = duration > 0 ? Math.round((currentTime / duration) * 100) : 0
  const ariaValueNow = Math.max(0, Math.min(100, rawAriaValueNow))

  return (
    <div
      data-testid="waveform-bars"
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label="Audio waveform"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ariaValueNow}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      className="relative w-full cursor-pointer select-none"
      style={{ ['--waveform-progress' as string]: '0%' }}
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
