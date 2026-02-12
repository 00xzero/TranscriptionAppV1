'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

interface CollapsibleWaveformProps {
  collapsed: boolean
  audioProgress: number
  onExpandClick: () => void
  onScrub?: (fraction: number) => void
  children: React.ReactNode
}

const DOUBLE_CLICK_DELAY_MS = 220

export default function CollapsibleWaveform({
  collapsed,
  audioProgress,
  onExpandClick,
  onScrub,
  children,
}: CollapsibleWaveformProps) {
  const clampedProgress = Math.min(100, Math.max(0, audioProgress))
  const barRef = useRef<HTMLDivElement | null>(null)
  const clickTimeoutRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

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

  const clearPendingClick = useCallback(() => {
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current)
      clickTimeoutRef.current = null
    }
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (onScrub) {
      if (e.detail > 1) return
      clearPendingClick()
      const clientX = e.clientX
      clickTimeoutRef.current = window.setTimeout(() => {
        onScrub(fractionFromEvent(clientX))
        clickTimeoutRef.current = null
      }, DOUBLE_CLICK_DELAY_MS)
    } else {
      onExpandClick()
    }
  }, [onScrub, onExpandClick, fractionFromEvent, clearPendingClick])

  const handleDoubleClick = useCallback(() => {
    if (!onScrub) return
    clearPendingClick()
    onExpandClick()
  }, [onScrub, onExpandClick, clearPendingClick])

  const handleMouseDown = useCallback(() => {
    if (!onScrub) return
    setIsDragging(true)
  }, [onScrub])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentFraction = clampedProgress / 100
    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault()
        if (onScrub) {
          onScrub(clampFraction(currentFraction))
        } else {
          onExpandClick()
        }
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
        e.preventDefault()
        if (onScrub) {
          onScrub(0)
        } else {
          onExpandClick()
        }
        break
      case 'End':
        if (!onScrub) break
        e.preventDefault()
        onScrub(1)
        break
      default:
        break
    }
  }, [clampedProgress, onScrub, onExpandClick, clampFraction])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      onScrub?.(fractionFromEvent(e.clientX))
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, onScrub, fractionFromEvent])

  useEffect(() => {
    return () => {
      clearPendingClick()
    }
  }, [clearPendingClick])

  return (
    <div className={`relative leading-none ${collapsed ? 'z-50' : 'z-30'}`}>
      {/* Mini progress bar — visible when collapsed */}
      {collapsed && (
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="Audio scrubber"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clampedProgress)}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          className="block w-full h-1.5 bg-ink/10 dark:bg-white/10 cursor-pointer group hover:bg-ink/15 dark:hover:bg-white/15 transition-colors select-none"
        >
          <div
            className="h-full bg-trust-blue transition-all duration-150 group-hover:bg-trust-blue/90 pointer-events-none"
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
      )}

      {/* Expandable waveform container */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${collapsed ? 'max-h-0 opacity-0' : 'max-h-72 opacity-100'
          }`}
      >
        <div className="relative pt-[56px] bg-paper dark:bg-black border-b border-ink/10 dark:border-white/10">
          {/* Gradient fades on edges */}
          <div className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-paper dark:from-black to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper dark:from-black to-transparent z-10 pointer-events-none" />

          {/* Waveform content */}
          <div className="px-6 py-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
