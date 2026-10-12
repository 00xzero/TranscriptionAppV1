'use client'

import React from 'react'
import { useScrubGesture, type ScrubEndHandler } from '@/lib/audio/useScrubGesture'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface CollapsibleWaveformProps {
  collapsed: boolean
  children: React.ReactNode
  contentRef?: (el: HTMLDivElement | null) => void
  expandedHeight?: number
  pinned?: boolean
  onFocusCapture?: React.FocusEventHandler<HTMLDivElement>
  onBlurCapture?: React.FocusEventHandler<HTMLDivElement>
}

interface MiniWaveformProgressProps {
  audioProgress: number
  duration: number
  sourceKey?: string | null
  onSeek?: (fraction: number) => void
  onSeekStart?: () => void
  onSeekEnd?: ScrubEndHandler
  interactive?: boolean
  onScrub?: (fraction: number) => void
  /** Called when the user begins a drag-scrub gesture */
  onScrubStart?: () => void
  /** Called once when a drag is released, cancelled or torn down. */
  onScrubEnd?: ScrubEndHandler
}

export function MiniWaveformProgress({
  audioProgress,
  duration,
  sourceKey,
  onSeek,
  onSeekStart,
  onSeekEnd,
  interactive = true,
  onScrub,
  onScrubStart,
  onScrubEnd,
}: MiniWaveformProgressProps) {
  const [tooltipDismissed, setTooltipDismissed] = React.useState(false)
  const normalizedProgress = Number.isFinite(audioProgress) ? audioProgress : 0
  const clampedProgress = Math.min(100, Math.max(0, normalizedProgress))
  const scrub = useScrubGesture({
    duration, fraction: clampedProgress / 100, interactive, sourceKey,
    onSeek, onSeekStart, onSeekEnd, onScrub, onScrubStart, onScrubEnd,
  })
  const visibleProgress = scrub.previewFraction !== null ? scrub.previewFraction * 100 : clampedProgress

  return (
    <TooltipProvider delayDuration={700} skipDelayDuration={0}>
      <Tooltip disabled={!interactive || tooltipDismissed} disableHoverableContent>
        <TooltipTrigger asChild>
          <div
            role="slider"
            {...scrub.sliderProps}
            // A press means the control is already understood. Keep the hint
            // dismissed through release until a fresh hover or keyboard intent.
            onPointerDownCapture={() => setTooltipDismissed(true)}
            onPointerEnter={(event) => { if (event.buttons === 0) setTooltipDismissed(false) }}
            onPointerLeave={(event) => { if (event.buttons === 0) setTooltipDismissed(false) }}
            onFocusCapture={(event) => {
              // Focus handed over after a scrub is still pointer intent.
              setTooltipDismissed(event.currentTarget.dataset.scrubPointerFocus === 'true')
            }}
            onKeyDownCapture={() => setTooltipDismissed(false)}
            onBlur={(event) => {
              scrub.sliderProps.onBlur(event)
              setTooltipDismissed(false)
            }}
            aria-valuenow={scrub.sliderProps['aria-valuenow']}
            aria-label="Audio scrubber"
            className="group relative block h-6 w-full cursor-pointer select-none outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trust-blue data-[scrub-pointer-focus=true]:focus-visible:outline-none"
            style={{ touchAction: 'pan-y pinch-zoom' }}
          >
            <div
              className="absolute top-0 h-1.5 w-full bg-subtle-hover transition-colors group-hover:bg-foreground/15 pointer-events-none"
            >
              <div
                className={`h-full bg-trust-blue group-hover:bg-trust-blue/90 ${scrub.previewFraction !== null ? 'transition-none' : 'transition-all duration-150'}`}
                style={{ width: `${visibleProgress}%` }}
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>Scrub audio</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default function CollapsibleWaveform({
  collapsed,
  children,
  contentRef,
  expandedHeight,
  pinned = false,
  onFocusCapture,
  onBlurCapture,
}: CollapsibleWaveformProps) {
  const spacerHeight = typeof expandedHeight === 'number' && Number.isFinite(expandedHeight) && expandedHeight > 0
    ? expandedHeight
    : undefined

  return (
    <div
      className={`relative leading-none ${pinned ? 'sticky top-0 z-(--z-editor-pinned-waveform)' : ''}`}
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
        inert={collapsed}
        onFocusCapture={onFocusCapture}
        onBlurCapture={onBlurCapture}
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
