"use client"

import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Avatar } from '@/components/ui/avatar'
import { IconButton } from '@/components/ui/icon-button'
import { countLabel } from '@/components/Projects/format'
import { cn } from '@/lib/utils'
import type { SpeakerOverview, SpeakerOverviewRow } from '../hooks/useSpeakerOverview'
import { msToTimestamp } from '../utils'

export type SpeakersSidebarHandle = {
  /** Open the row and turn that hold this segment, as the speaker popover's panel button asks. */
  reveal: (segmentId: string) => void
}

/** Long enough for a row's open animation (150ms), so the row is scrolled to at its full height. */
const REVEAL_AFTER_MS = 160

type SpeakersSidebarProps = {
  ref?: React.Ref<SpeakersSidebarHandle>
  id: string
  /** Kept mounted while closed, so it can animate both ways and keep each row's place. */
  open: boolean
  overview: SpeakerOverview
  /** Scroll the transcript and the audio to a turn's first segment. */
  onJump: (segmentId: string) => void
  onClose: () => void
}

/**
 * Where everyone speaks, one row per speaker, for getting to a speaker's turns
 * without scrolling the transcript. Naming stays in the speaker popover on the
 * turn itself; this panel only takes you there.
 *
 * Its state is segment ids, never identity keys. Naming a detected speaker
 * moves its segments to a new speaker, a provisional speaker id is later
 * swapped for the saved one, and Undo moves the segments back; each changes
 * the identity key. The open row and each row's current turn are worked out
 * from wherever those segments are now, so all three leave you where you were.
 */
export function SpeakersSidebar({ ref, id, open, overview, onJump, onClose }: SpeakersSidebarProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  /** The pending focus-and-scroll from `reveal`: one at a time, and none after unmount. */
  const revealTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(revealTimerRef.current), [])
  /** A segment in the open row's current turn. Null when every row is closed. */
  const [openAnchor, setOpenAnchor] = useState<string | null>(null)
  /**
   * One segment per row visited: its current turn. A row keeps its turn while it
   * animates closed and when it is opened again.
   */
  const [turnAnchors, setTurnAnchors] = useState<readonly string[]>([])

  // Opening moves focus here, so the panel is announced and its first row is one Tab away.
  useEffect(() => { if (open) headingRef.current?.focus({ preventScroll: true }) }, [open])

  const openRowKey = useMemo(() => locateTurn(overview.rows, openAnchor)?.row.key ?? '', [overview.rows, openAnchor])
  const turnByRow = useMemo(() => currentTurns(overview.rows, turnAnchors), [overview.rows, turnAnchors])

  /** Makes the turn holding `segmentId` its row's current turn. */
  const rememberTurn = (rowKey: string, segmentId: string) => setTurnAnchors((anchors) => [
    ...anchors.filter((anchor) => locateTurn(overview.rows, anchor)?.row.key !== rowKey),
    segmentId,
  ])

  useImperativeHandle(ref, () => ({
    reveal(segmentId) {
      const found = locateTurn(overview.rows, segmentId)
      if (!found) return
      rememberTurn(found.row.key, segmentId)
      setOpenAnchor(segmentId)
      // After the row has opened: bring it into view and put focus on it, so
      // the keyboard lands where the popover sent you. A newer reveal replaces
      // this one rather than queueing behind it.
      window.clearTimeout(revealTimerRef.current)
      revealTimerRef.current = window.setTimeout(() => {
        revealTimerRef.current = undefined
        const trigger = asideRef.current?.querySelector<HTMLElement>('[data-state="open"] > h3 > button')
        trigger?.closest('[data-state="open"]')?.scrollIntoView({ block: 'nearest' })
        // Only take focus nobody else has claimed. Closing the popover drops
        // focus to the page; if the reader has since clicked or typed into
        // something else, moving them would steal it.
        const focused = document.activeElement
        const focusIsFree = !focused || focused === document.body || !!asideRef.current?.contains(focused)
        if (focusIsFree) trigger?.focus({ preventScroll: true })
      }, REVEAL_AFTER_MS)
    },
  }))

  const goToTurn = (row: SpeakerOverviewRow, turnIndex: number) => {
    const turn = row.turns[turnIndex]
    if (!turn) return
    rememberTurn(row.key, turn.segmentId)
    setOpenAnchor(turn.segmentId)
    onJump(turn.segmentId)
  }

  const summary = [
    countLabel(overview.speakerCount, 'speaker', 'speakers'),
    overview.unnamedCount > 0 && `${overview.unnamedCount} unnamed`,
  ].filter(Boolean).join(' · ')

  return (
    <aside
      ref={asideRef}
      id={id}
      aria-labelledby={`${id}-heading`}
      onKeyDown={(event) => {
        // A tooltip or other Radix layer inside the panel dismisses itself on
        // Escape and marks the event handled; only a bare Escape closes the panel.
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          onClose()
        }
      }}
      // Closed, it is out of the tab order and the accessibility tree, but still
      // mounted, so it can animate out and its rows keep their turns.
      inert={!open}
      className={cn(
        // The same surface as the app's left navigation, so the two side panels match.
        'z-50 shrink-0 overflow-hidden border-border bg-surface-alt dark:bg-night-surface',
        // Narrow screens: slides over the transcript from the right edge.
        // It starts below the app header, which floats over the editor.
        'absolute bottom-0 right-0 top-[var(--header-height)] w-[min(20rem,100%)] border-l shadow-float',
        'transition-[translate,opacity] duration-100 ease-in-out motion-reduce:transition-none',
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0',
        // Wide screens: beside the transcript, opening its width like the app's
        // left navigation does (same duration and easing), pushing it narrower.
        'lg:static lg:mt-[var(--header-height)] lg:translate-x-0 lg:opacity-100 lg:shadow-none lg:transition-[width]',
        open ? 'lg:w-80' : 'lg:w-0 lg:border-l-0'
      )}
    >
      {/* A fixed width inside, so the panel's own content never rewraps while its edge moves;
          it fades and slides in step with the edge, as the navigation's labels do. */}
      <div
        className={cn(
          'flex h-full w-[min(20rem,100vw)] flex-col overflow-y-auto lg:w-80',
          'transition-[opacity,translate] duration-100 ease-in-out motion-reduce:transition-none',
          open ? 'translate-x-0 opacity-100' : 'translate-x-1 opacity-0'
        )}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-2.5">
          <div className="min-w-0">
            <h2
              id={`${id}-heading`}
              ref={headingRef}
              tabIndex={-1}
              className="font-serif text-lg italic leading-snug text-foreground focus:outline-none"
            >
              Speakers
            </h2>
            <p className="text-[11px] leading-tight text-muted">{summary}</p>
          </div>
          <IconButton label="Close speakers" icon={<X className="h-4 w-4" />} onClick={onClose} />
        </div>

        <Accordion
          type="single"
          collapsible
          value={openRowKey}
          onValueChange={(key) => {
            const row = overview.rows.find((candidate) => candidate.key === key)
            // Opening a row shows its current turn (its first, the first time) without jumping.
            setOpenAnchor(row ? row.turns[turnByRow.get(row.key) ?? 0]?.segmentId ?? null : null)
          }}
          className="border-t border-border px-5"
        >
          {overview.rows.map((row) => (
            <AccordionItem
              key={row.key}
              value={row.key}
              className="-mx-2 rounded-lg px-2 last:border-b-0 data-[state=open]:border-transparent data-[state=open]:bg-subtle"
            >
              <AccordionTrigger aria-label={`${row.label}${row.unnamed ? ', unnamed' : ''}, ${row.shareLabel} of talk time`}>
                <Avatar size="md" color={row.color}>{row.avatarText}</Avatar>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{row.label}</span>
                    {row.unnamed && (
                      <span className="shrink-0 rounded-full bg-warm-highlight px-1.5 text-[10px] text-transcribe dark:bg-night-highlight dark:text-warm-highlight">
                        unnamed
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${row.share > 0 ? Math.max(row.share, 0.01) * 100 : 0}%`, backgroundColor: row.color }}
                    />
                  </span>
                </span>
                <span className="w-9 shrink-0 text-right font-mono text-xs text-muted" aria-hidden="true">{row.shareLabel}</span>
              </AccordionTrigger>
              <AccordionContent>
                {/* Radix mounts this only while the row is open or animating closed. */}
                <TurnNavigator
                  row={row}
                  turnIndex={turnByRow.get(row.key) ?? 0}
                  timelineMs={overview.timelineMs}
                  onGoToTurn={(turnIndex) => goToTurn(row, turnIndex)}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </aside>
  )
}

/** The row and turn holding `segmentId`, wherever the segment's speaker now is. */
function locateTurn(rows: readonly SpeakerOverviewRow[], segmentId: string | null) {
  if (!segmentId) return null
  for (const row of rows) {
    const turnIndex = row.turns.findIndex((turn) => turn.segmentIds.includes(segmentId))
    if (turnIndex >= 0) return { row, turnIndex }
  }
  return null
}

/** Each visited row's current turn, from the segments remembered for it. */
function currentTurns(rows: readonly SpeakerOverviewRow[], anchors: readonly string[]) {
  const turns = new Map<string, number>()
  for (const anchor of anchors) {
    const found = locateTurn(rows, anchor)
    if (found) turns.set(found.row.key, found.turnIndex)
  }
  return turns
}

function TurnNavigator({ row, turnIndex, timelineMs, onGoToTurn }: {
  row: SpeakerOverviewRow
  turnIndex: number
  timelineMs: number
  onGoToTurn: (turnIndex: number) => void
}) {
  const turns = row.turns
  const turn = turns[turnIndex]
  const step = (delta: number) => onGoToTurn((turnIndex + delta + turns.length) % turns.length)
  const position = (ms: number) => (timelineMs > 0 ? Math.min(ms / timelineMs, 1) : 0)

  return (
    <div className="space-y-2.5">
      <div>
        <p className="mb-1 text-[11px] text-muted">{countLabel(turns.length, 'turn', 'turns')} · where they speak</p>
        {/* Pointer-only: a speaker with 100+ turns must not become 100+ tab stops.
            The ‹ › buttons below reach every turn from the keyboard. */}
        <div
          aria-hidden="true"
          data-testid="turn-timeline"
          className="relative h-3.5 cursor-pointer rounded bg-subtle"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
            let nearest = 0
            turns.forEach((candidate, index) => {
              if (Math.abs(position(candidate.startMs) - fraction) < Math.abs(position(turns[nearest].startMs) - fraction)) nearest = index
            })
            onGoToTurn(nearest)
          }}
        >
          {turns.map((candidate, index) => (
            <span
              key={candidate.segmentId}
              className={cn(
                'absolute w-[3px] -translate-x-1/2 rounded-sm',
                index === turnIndex ? 'top-0 h-full bg-trust-blue' : 'top-[3px] h-2 opacity-70'
              )}
              style={{ left: `${position(candidate.startMs) * 100}%`, ...(index === turnIndex ? {} : { backgroundColor: row.color }) }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-muted" aria-hidden="true">
          <span>{msToTimestamp(0)}</span>
          <span>{msToTimestamp(timelineMs)}</span>
        </div>
      </div>

      {turn && (
        <button
          type="button"
          onClick={() => onGoToTurn(turnIndex)}
          className="-mx-2 -mt-1.5 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/60"
          aria-label={`Go to turn ${turnIndex + 1} at ${msToTimestamp(turn.startMs)}: ${turn.excerpt}`}
        >
          <span className="block font-mono text-[11px] text-trust-blue">{msToTimestamp(turn.startMs)}</span>
          {/* Always two lines tall, so the buttons below stay put while you click through turns. */}
          <span className="mt-0.5 line-clamp-2 h-[2lh] font-sans text-sm leading-relaxed text-ink/90 dark:text-paper/80">
            {turn.excerpt || '…'}
          </span>
        </button>
      )}

      <div className="-mt-2 flex items-center justify-center gap-1">
        <IconButton label="Previous turn" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => step(-1)} />
        <span className="min-w-[5.5rem] text-center text-xs text-muted" aria-live="polite">
          turn {turnIndex + 1} of {turns.length}
        </span>
        <IconButton label="Next turn" icon={<ChevronRight className="h-4 w-4" />} onClick={() => step(1)} />
      </div>
    </div>
  )
}
