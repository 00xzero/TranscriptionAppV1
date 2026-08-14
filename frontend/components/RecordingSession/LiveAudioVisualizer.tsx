"use client"

/**
 * Vendored from `react-audio-visualize` (LiveAudioVisualizer + its draw
 * helpers) by Samhir Tarif — MIT License.
 * https://github.com/samhirtarif/react-audio-visualize
 *
 * Copied into the tree (rather than depending on the npm package) because the
 * published v1.2.0 bundles its own React-<=18 JSX runtime that reads
 * `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner`
 * at import time, which no longer exists in React 19 and crashes the build.
 * This source uses only public React APIs, so it compiles against React 19.
 *
 * It builds its own AudioContext + AnalyserNode from `mediaRecorder.stream`,
 * draws the current frequency spectrum to a canvas each frame while recording,
 * draws a flat frame and halts when the recorder is paused, and tears down the
 * AudioContext on unmount.
 *
 * Local modifications to the draw helpers (for visual consistency with
 * components/Waveform.tsx):
 *   - `calculateBarData` produces a symmetric "butterfly" strip — the loudest
 *     (low-frequency) energy sits at the center and tapers out to both edges,
 *     so the left half mirrors the right.
 *   - `draw` scales bar height to the canvas (no clipping), centers each bar on
 *     the midline, applies a minimum-height floor so silence stays faintly
 *     visible, and uses pill-shaped bars (radius = barWidth / 2).
 */

import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import { getAudioContextConstructor } from '@/lib/recording/audioContext'

interface CustomCanvasRenderingContext2D extends CanvasRenderingContext2D {
  roundRect: (x: number, y: number, w: number, h: number, radius: number) => void
}

// Minimum bar height as a fraction of the canvas, mirroring Waveform.tsx's
// MIN_BAR_HEIGHT_PCT so silent regions stay faintly visible.
const MIN_BAR_HEIGHT_FRACTION = 0.06
// Increase this to make the live waveform respond more dramatically to quieter
// input; decrease it if normal speech starts clipping at full height too often.
const WAVEFORM_SENSITIVITY = 1.5

// Build a symmetric "butterfly" strip from the frequency data: the center bars
// sample the lowest (loudest) frequency bins and bars taper out to the highest
// bins at both edges, so the left half mirrors the right.
export function calculateBarData(
  frequencyData: Uint8Array,
  width: number,
  barWidth: number,
  gap: number
): number[] {
  const totalBarWidth = barWidth + gap
  const units = Math.max(1, Math.floor(width / totalBarWidth))
  const center = (units - 1) / 2
  const maxDistance = Math.max(1, Math.ceil(center))
  const step = Math.max(1, Math.floor(frequencyData.length / maxDistance))

  const data: number[] = []
  for (let i = 0; i < units; i++) {
    const distance = Math.round(Math.abs(i - center))
    const start = Math.min(distance * step, frequencyData.length - 1)
    let sum = 0
    let count = 0
    for (let j = 0; j < step && start + j < frequencyData.length; j++) {
      sum += frequencyData[start + j]
      count++
    }
    data.push(count > 0 ? sum / count : 0)
  }
  return data
}

function draw(
  data: number[],
  canvas: HTMLCanvasElement,
  barWidth: number,
  gap: number,
  backgroundColor: string,
  barColor: string
): void {
  const ctx = canvas.getContext('2d') as CustomCanvasRenderingContext2D | null
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const totalBarWidth = barWidth + gap
  const minHeight = canvas.height * MIN_BAR_HEIGHT_FRACTION
  const radius = barWidth / 2
  // Center the bar field horizontally so leftover sub-bar width splits evenly.
  const xStart = (canvas.width - (data.length * totalBarWidth - gap)) / 2

  ctx.fillStyle = barColor
  data.forEach((dp, i) => {
    // dp is a 0–255 frequency magnitude; scale it to the canvas height.
    const h = Math.max(
      minHeight,
      Math.min(canvas.height, (dp / 255) * canvas.height * WAVEFORM_SENSITIVITY)
    )
    const x = xStart + i * totalBarWidth
    const y = (canvas.height - h) / 2 // centered on the midline → vertically symmetric

    ctx.beginPath()
    if (ctx.roundRect) {
      ctx.roundRect(x, y, barWidth, h, radius)
      ctx.fill()
    } else {
      ctx.fillRect(x, y, barWidth, h)
    }
  })
}

export interface LiveAudioVisualizerProps {
  mediaRecorder: MediaRecorder
  className?: string
  width?: number | string
  height?: number | string
  barWidth?: number
  gap?: number
  backgroundColor?: string
  /** Optional concrete canvas color. When omitted, the canvas element's
      computed `color` is used so theme utilities remain the source of truth. */
  barColor?: string
  fftSize?: 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096 | 8192 | 16384 | 32768
  maxDecibels?: number
  minDecibels?: number
  smoothingTimeConstant?: number
}

export function LiveAudioVisualizer({
  mediaRecorder,
  className,
  width = '100%',
  height = '100%',
  barWidth = 2,
  gap = 1,
  backgroundColor = 'transparent',
  barColor,
  fftSize = 1024,
  maxDecibels = -10,
  minDecibels = -90,
  smoothingTimeConstant = 0.4,
}: LiveAudioVisualizerProps): ReactElement {
  const contextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const resolvedBarColorRef = useRef<string | null>(barColor ?? null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    resolvedBarColorRef.current = barColor ?? getComputedStyle(canvas).color
  }, [barColor, className])

  const cancelReportFrame = useCallback(() => {
    if (rafRef.current == null) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  useEffect(() => {
    if (!mediaRecorder.stream) return

    const AudioContextCtor = getAudioContextConstructor()
    if (!AudioContextCtor) return

    const ctx = new AudioContextCtor()
    const analyserNode = ctx.createAnalyser()
    analyserNode.fftSize = fftSize
    analyserNode.minDecibels = minDecibels
    analyserNode.maxDecibels = maxDecibels
    analyserNode.smoothingTimeConstant = smoothingTimeConstant
    const source = ctx.createMediaStreamSource(mediaRecorder.stream)
    source.connect(analyserNode)
    contextRef.current = ctx
    analyserRef.current = analyserNode

    return () => {
      cancelReportFrame()
      source.disconnect()
      analyserNode.disconnect()
      if (ctx.state !== 'closed') ctx.close()
      if (contextRef.current === ctx) contextRef.current = null
      if (analyserRef.current === analyserNode) analyserRef.current = null
    }
  }, [
    cancelReportFrame,
    fftSize,
    maxDecibels,
    mediaRecorder.stream,
    minDecibels,
    smoothingTimeConstant,
  ])

  const processFrequencyData = useCallback(
    (data: Uint8Array): void => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dataPoints = calculateBarData(
        data,
        canvas.width,
        barWidth,
        gap
      )
      const resolvedBarColor = resolvedBarColorRef.current
      if (!resolvedBarColor) return
      draw(dataPoints, canvas, barWidth, gap, backgroundColor, resolvedBarColor)
    },
    [backgroundColor, barWidth, gap]
  )

  useEffect(() => {
    cancelReportFrame()
    const analyser = analyserRef.current
    const context = contextRef.current
    if (!analyser || !context) return
    const buffer = new Uint8Array(analyser.frequencyBinCount)

    if (mediaRecorder.state === 'recording') {
      const report = () => {
        analyser.getByteFrequencyData(buffer)
        processFrequencyData(buffer)
        rafRef.current = requestAnimationFrame(report)
      }
      report()
      return cancelReportFrame
    }

    if (mediaRecorder.state === 'paused') {
      buffer.fill(0)
      processFrequencyData(buffer)
      return
    }

    if (mediaRecorder.state === 'inactive' && context.state !== 'closed') {
      context.close()
    }
  }, [
    barColor,
    cancelReportFrame,
    className,
    fftSize,
    maxDecibels,
    mediaRecorder.state,
    mediaRecorder.stream,
    minDecibels,
    processFrequencyData,
    smoothingTimeConstant,
  ])

  useEffect(() => {
    return () => {
      cancelReportFrame()
    }
  }, [cancelReportFrame])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={width}
      height={height}
      style={{ aspectRatio: 'unset' }}
    />
  )
}
