'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface CollapsibleWaveformProps {
  collapsed: boolean
  children: React.ReactNode
  contentRef?: (el: HTMLDivElement | null) => void
  pinned?: boolean
}

interface MiniWaveformProgressProps {
  audioProgress: number
  onScrub?: (fraction: number) => void
  /** Called when the user begins a drag-scrub gesture */
  onScrubStart?: () => void
  /** Called when the user releases a drag-scrub gesture */
  onScrubEnd?: () => void
}

export function MiniWaveformProgress({
  audioProgress,
  onScrub,
  onScrubStart,
  onScrubEnd,
}: MiniWaveformProgressProps) {
  const normalizedProgress = Number.isFinite(audioProgress) ? audioProgress : 0
  const clampedProgress = Math.min(100, Math.max(0, normalizedProgress))
  const barRef = useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragFraction, setDragFraction] = useState<number | null>(null)

  const clampFraction = useCallback((fraction: number) => {
    if (!Number.isFinite(fraction)) return 0
    return Math.max(0, Math.min(1, fraction))
  }, [])

  const fractionFromEvent = useCallback((clientX: number): number => {
    const bar = barRef.current
    if (!bar) return 0
    const rect = bar.getBoundingClientRect()
    const width = rect.width
    if (!width || !Number.isFinite(width)) return 0
    const fraction = (clientX - rect.left) / width
    return clampFraction(fraction)
  }, [clampFraction])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onScrub) return
    const fraction = fractionFromEvent(e.clientX)
    setDragFraction(fraction)
    setIsDragging(true)
    onScrubStart?.()
    onScrub(fraction)
  }, [fractionFromEvent, onScrub, onScrubStart])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentFraction = clampedProgress / 100
    switch (e.key) {
      case ' ':
      case 'Spacebar':
        if (!onScrub) break
        e.preventDefault()
        onScrub(clampFraction(currentFraction))
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        if (!onScrub) break
        e.preventDefault()
        onScrub(clampFraction(currentFraction - 0.05))
        break
      case 'ArrowRight':
      case 'ArrowUp':
        if (!onScrub) break
        e.preventDefault()
        onScrub(clampFraction(currentFraction + 0.05))
        break
      case 'Home':
        if (!onScrub) break
        e.preventDefault()
        onScrub(0)
        break
      case 'End':
        if (!onScrub) break
        e.preventDefault()
        onScrub(1)
        break
      default:
        break
    }
  }, [clampedProgress, onScrub, clampFraction])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const fraction = fractionFromEvent(e.clientX)
      setDragFraction(fraction)
      onScrub?.(fraction)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setDragFraction(null)
      onScrubEnd?.()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, onScrub, onScrubEnd, fractionFromEvent])

  const visibleProgress = dragFraction !== null ? dragFraction * 100 : clampedProgress

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="Audio scrubber"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(visibleProgress)}
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          className="block w-full h-1.5 bg-ink/10 dark:bg-white/10 cursor-pointer group hover:bg-ink/15 dark:hover:bg-white/15 transition-colors select-none"
        >
          <div
            className={`h-full bg-trust-blue group-hover:bg-trust-blue/90 pointer-events-none ${dragFraction !== null ? 'transition-none' : 'transition-all duration-150'}`}
            style={{ width: `${visibleProgress}%` }}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>Scrub audio</TooltipContent>
    </Tooltip>
  )
}

export default function CollapsibleWaveform({
  collapsed,
  children,
  contentRef,
  pinned = false,
}: CollapsibleWaveformProps) {
  return (
    <div className={`relative leading-none ${pinned ? 'sticky top-0 z-30' : ''}`}>
      {/* Expandable waveform container */}
      <div
        ref={contentRef}
        className={`overflow-hidden transition-[max-height,padding,opacity] duration-500 ease-in-out ${collapsed ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-[500px] opacity-100'
          }`}
      >
        <div className="relative pt-[56px] bg-paper dark:bg-black border-b border-ink/10 dark:border-white/10">
          {/* Gradient fades on edges — matches Olivetti.html:696 */}
          <div className="absolute inset-y-0 left-0 w-20 bg-linear-to-r from-paper dark:from-black to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-20 bg-linear-to-l from-paper dark:from-black to-transparent z-10 pointer-events-none" />

          {/* Waveform content. The shell's pt-[56px] clears the editor header;
              pt-6 adds the remaining breathing room from Olivetti's pt-20. */}
          <div className="px-6 md:px-20 pt-6 pb-2">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
