'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
const PX_PER_BAR = 8

function clampFraction(f: number): number {
    if (!Number.isFinite(f)) return 0
    return Math.max(0, Math.min(1, f))
}

/**
 * Downsample source peaks to N display bars using max-of-window aggregation.
 * Source bars per display bar can be fractional, so we walk the source array
 * with a floating cursor.
 */
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

    // Width tracking via ResizeObserver, debounced so resize doesn't thrash.
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
        // Seed initial width synchronously
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

    const displayBars = useMemo(
        () => downsamplePeaks(peaks, barCount),
        [peaks, barCount]
    )

    // Drive the active-region clip via a CSS variable, set imperatively so
    // React never re-renders the bar grids during playback. Only the wrapper's
    // inline style mutates per timeupdate, and the bars are children of that.
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

    const ariaValueNow = duration > 0 ? Math.round((currentTime / duration) * 100) : 0

    return (
        <div
            ref={containerRef}
            data-testid="waveform-bars"
            role="slider"
            tabIndex={0}
            aria-label="Audio waveform"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={ariaValueNow}
            onMouseDown={handleMouseDown}
            onKeyDown={handleKeyDown}
            className="relative h-32 w-full cursor-pointer select-none"
            style={{ ['--waveform-progress' as string]: '0%' }}
        >
            {/* Inactive bar layer */}
            <BarLayer
                bars={displayBars}
                className="absolute inset-0 flex items-center justify-between gap-px text-ink/20 dark:text-[#333]"
            />
            {/* Active (played) bar layer — same bars, different color, clipped by --waveform-progress */}
            <div
                className="absolute inset-0 overflow-hidden pointer-events-none"
                style={{ clipPath: 'inset(0 calc(100% - var(--waveform-progress)) 0 0)' }}
            >
                <BarLayer
                    bars={displayBars}
                    className="absolute inset-0 flex items-center justify-between gap-px text-trust-blue"
                />
            </div>
            {/* Playhead line */}
            <div
                aria-hidden
                className="absolute top-0 bottom-0 w-px bg-trust-blue pointer-events-none"
                style={{ left: 'var(--waveform-progress)' }}
            />
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
                    className="bg-current rounded-full"
                    style={{
                        // Minimum 4% so silent regions are still visible
                        height: `${Math.max(4, height * 100)}%`,
                        width: `${100 / bars.length}%`,
                        maxWidth: '4px',
                    }}
                />
            ))}
        </div>
    )
})
