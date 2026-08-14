'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface CollapsibleWaveformProps {
  collapsed: boolean
  children: React.ReactNode
  contentRef?: (el: HTMLDivElement | null) => void
  expandedHeight?: number
  pinned?: boolean
}

interface MiniWaveformProgressProps {
  audioProgress: number
  interactive?: boolean
  onScrub?: (fraction: number) => void
  /** Called when the user begins a drag-scrub gesture */
  onScrubStart?: () => void
  /** Called when the user releases a drag-scrub gesture */
  onScrubEnd?: () => void
}

export function MiniWaveformProgress({
  audioProgress,
  interactive = true,
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
    if (!interactive) return
    if (!onScrub) return
    const fraction = fractionFromEvent(e.clientX)
    setDragFraction(fraction)
    setIsDragging(true)
    onScrubStart?.()
    onScrub(fraction)
  }, [fractionFromEvent, interactive, onScrub, onScrubStart])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return
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
  }, [clampedProgress, interactive, onScrub, clampFraction])

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
          tabIndex={interactive ? 0 : -1}
          aria-label="Audio scrubber"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(visibleProgress)}
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          className="group block h-1.5 w-full cursor-pointer select-none bg-subtle-hover transition-colors hover:bg-foreground/15"
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
  expandedHeight,
  pinned = false,
}: CollapsibleWaveformProps) {
  const spacerHeight = typeof expandedHeight === 'number' && Number.isFinite(expandedHeight) && expandedHeight > 0
    ? expandedHeight
    : undefined

  return (
    <div
      className={`relative leading-none ${pinned ? 'sticky top-0 z-30' : ''}`}
      style={
        spacerHeight
          ? collapsed
            ? { height: spacerHeight }
            : { minHeight: spacerHeight }
          : undefined
      }
    >
      {/* Expandable waveform container */}
      <div
        ref={contentRef}
        className={`overflow-hidden transition-opacity duration-300 ease-in-out ${collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
      >
        <div className="relative border-b border-subtle-border bg-background pt-[var(--header-height)]">
          {/* Gradient fades on edges — matches Olivetti.html:696 */}
          <div className="absolute inset-y-0 left-0 z-10 w-20 bg-linear-to-r from-background to-transparent pointer-events-none" />
          <div className="absolute inset-y-0 right-0 z-10 w-20 bg-linear-to-l from-background to-transparent pointer-events-none" />

          {/* Waveform content. The shell's shared header-height padding clears the editor header;
              pt-6 adds the remaining breathing room from Olivetti's pt-20. */}
          <div className="px-6 md:px-20 pt-6 pb-2">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
