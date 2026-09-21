'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import type { Project } from '@/contracts/db'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  RecentProjectCard,
  RecentProjectCardSkeleton,
  type RecentProjectCardViewData,
} from './RecentProjectCard'

export type CarouselBoundaries = {
  atStart: boolean
  atEnd: boolean
  fits: boolean
}

/** Sub-pixel slack so fractional scroll offsets still register as a boundary. */
const BOUNDARY_EPSILON = 1

/**
 * Pure boundary maths for the scroll track.
 *
 * Kept separate from the component because jsdom reports every layout box as 0, so this
 * is the only place the disabled/hidden behaviour of the nav controls can be tested.
 */
export function carouselBoundaries({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
}): CarouselBoundaries {
  const maxScroll = Math.max(0, scrollWidth - clientWidth)
  return {
    fits: maxScroll <= BOUNDARY_EPSILON,
    atStart: scrollLeft <= BOUNDARY_EPSILON,
    atEnd: scrollLeft >= maxScroll - BOUNDARY_EPSILON,
  }
}

/** Slides visible at each breakpoint. */
const VISIBLE_AT = { base: 1, md: 2, lg: 3 } as const

/**
 * Slide width per breakpoint.
 *
 * When the slides fit, they divide the track exactly so the row reads as a plain grid.
 * Once they overflow they shrink slightly, leaving about a tenth of the next slide
 * showing as the "there is more this way" hint. Both cases are chosen from the slide
 * count, which is known at render — nothing here measures the layout.
 */
function slideWidthClasses(slideCount: number): string {
  return cn(
    slideCount > VISIBLE_AT.base ? '[--slide-basis:86%]' : '[--slide-basis:100%]',
    slideCount > VISIBLE_AT.md
      ? 'md:[--slide-basis:45%]'
      : 'md:[--slide-basis:calc((100%_-_1.5rem)_/_2)]',
    slideCount > VISIBLE_AT.lg
      ? 'lg:[--slide-basis:30%]'
      : 'lg:[--slide-basis:calc((100%_-_3rem)_/_3)]'
  )
}

const SLIDE = 'snap-start shrink-0 basis-(--slide-basis)'

type RecentProjectsCarouselProps = {
  cards: RecentProjectCardViewData[]
  loading: boolean
  onCreate: () => void
  /** Keeps the carousel unaware of dialogs and provider state, as ProjectRow is. */
  renderCardActions?: (project: Project) => ReactNode
}

export function RecentProjectsCarousel({
  cards,
  loading,
  onCreate,
  renderCardActions,
}: RecentProjectsCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [boundaries, setBoundaries] = useState<CarouselBoundaries>({
    atStart: true,
    atEnd: true,
    fits: true,
  })

  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    setBoundaries(
      carouselBoundaries({
        scrollLeft: track.scrollLeft,
        clientWidth: track.clientWidth,
        scrollWidth: track.scrollWidth,
      })
    )
  }, [])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    measure()
    track.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(track)

    return () => {
      track.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [measure, cards.length, loading])

  // Paging by the track's own width advances exactly the number of slides on screen at
  // every breakpoint; snap alignment absorbs the peek offset.
  const page = (direction: 1 | -1) => {
    const track = trackRef.current
    if (!track) return
    track.scrollBy({ left: direction * track.clientWidth })
  }

  const slideCount = (loading ? 3 : cards.length) + 1
  const showControls = !loading && !boundaries.fits

  return (
    <section aria-labelledby="recent-projects-heading">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-(--border) pb-2">
        <h3
          id="recent-projects-heading"
          className="font-serif text-xl text-ink dark:text-paper"
        >
          Recent Projects
        </h3>
        <div className="flex items-center gap-2">
          {showControls && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Previous projects"
                disabled={boundaries.atStart}
                onClick={() => page(-1)}
                className="px-1.5 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Next projects"
                disabled={boundaries.atEnd}
                onClick={() => page(1)}
                className="px-1.5 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </>
          )}
          <Link
            href="/projects"
            title="View all projects"
            className="font-mono text-xs uppercase tracking-wide text-trust-blue hover:underline"
          >
            View All
          </Link>
        </div>
      </div>

      <div
        ref={trackRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Recent projects"
        className={cn(
          'flex items-stretch gap-6 overflow-x-auto overscroll-x-contain',
          'scroll-smooth motion-reduce:scroll-auto snap-x snap-mandatory',
          // Without this the browser anchors the scroll offset to whichever card sat
          // under it, so gaining a slide jumps the track to the end.
          '[overflow-anchor:none]',
          // The cards lift on hover and carry a tab above their top edge, so the track
          // needs slack the negative margins give straight back to the layout.
          '-mx-1 -my-4 px-1 py-4 scroll-px-1',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          slideWidthClasses(slideCount)
        )}
      >
        {loading
          ? [0, 1, 2].map((item) => (
              <div key={item} className={SLIDE}>
                <RecentProjectCardSkeleton />
              </div>
            ))
          : cards.map((card, index) => (
              <div
                key={card.project.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${cards.length}`}
                className={SLIDE}
              >
                <RecentProjectCard {...card} actions={renderCardActions?.(card.project)} />
              </div>
            ))}

        <button
          type="button"
          onClick={onCreate}
          aria-label="New project folder"
          className={cn(
            SLIDE,
            // Tracks RecentProjectCard's min-height; if one changes so must
            // the other, or the last slide stands shorter than the rest.
            'group flex min-h-52 flex-col items-center justify-center gap-2 rounded-lg',
            'border-2 border-dashed border-border text-muted transition-all',
            'hover:border-trust-blue/50 hover:bg-trust-blue/5 hover:text-trust-blue'
          )}
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
          <span className="font-serif text-sm italic">New Project Folder</span>
        </button>
      </div>
    </section>
  )
}
