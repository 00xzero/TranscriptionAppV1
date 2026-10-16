'use client'

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FigureControls, FigureName } from '@/lib/hairline'
import { cn } from '@/lib/utils'

export interface EmptyStateAction {
  label: string
  onClick: () => void
  /** Shows a plus before the label, for actions that create something. */
  creates?: boolean
}

/**
 * The one empty-state layout: a Hairline drawing, a small label, a serif line,
 * a sentence and at most one action. `full` stands centred under a page title;
 * `compact` sits beside a section heading.
 *
 * The drawing answers only the pointer on it: the key or card under the
 * pointer moves, and anywhere else it rests. The action previews what it will
 * do, and the drawing makes one short entrance when it first appears. The drawing's box is reserved on the
 * server, so nothing shifts when it loads in the browser.
 */
export function EmptyState({
  figure,
  eyebrow,
  title,
  description,
  action,
  size = 'full',
  titleAs: Title = 'h2',
}: {
  figure: FigureName
  eyebrow: string
  title: string
  description: string
  action?: EmptyStateAction
  size?: 'full' | 'compact'
  titleAs?: 'h2' | 'h3' | 'h4'
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<FigureControls | null>(null)
  const previewingRef = useRef(false)
  const overRef = useRef(false)
  const compact = size === 'compact'

  useEffect(() => {
    const host = hostRef.current
    // Test DOMs lack what the drawing loop needs; the reserved box is enough there.
    if (!host || typeof IntersectionObserver === 'undefined' || typeof window.matchMedia !== 'function') return
    let cancelled = false
    void import('@/lib/hairline').then(({ mountFigure }) => {
      if (cancelled) return
      // Full size crops to the drawing, so it fills its box; compact keeps the margins.
      controlsRef.current = mountFigure(figure, host, { tight: !compact })
      controlsRef.current.arrive()
    })
    return () => {
      cancelled = true
      controlsRef.current?.destroy()
      controlsRef.current = null
    }
  }, [figure, compact])

  const track = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Touch scrolls the page; only a hovering pointer drives the drawing.
    const host = hostRef.current
    if (previewingRef.current || event.pointerType === 'touch' || !host) return
    const box = host.getBoundingClientRect()
    const { clientX: x, clientY: y } = event
    // Only the drawing itself answers: the part under the pointer, that key, that card.
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
      overRef.current = true
      controlsRef.current?.point(x, y)
    } else if (overRef.current) {
      // Off the drawing, it goes back to rest, once.
      overRef.current = false
      controlsRef.current?.release()
    }
  }
  const release = () => {
    previewingRef.current = false
    overRef.current = false
    controlsRef.current?.release()
  }
  const preview = () => {
    previewingRef.current = true
    controlsRef.current?.preview()
  }

  return (
    <div
      onPointerMove={track}
      onPointerLeave={release}
      className={cn(
        'grid grid-cols-[minmax(0,1fr)] justify-items-center gap-1.5 text-center touch-pan-y',
        compact
          ? 'py-2 sm:grid-cols-[176px_minmax(0,1fr)] sm:items-center sm:justify-items-start sm:gap-x-[22px] sm:gap-y-0 sm:text-left'
          : 'pb-8 pt-4'
      )}
    >
      <div
        ref={hostRef}
        data-hairline={figure}
        aria-hidden="true"
        className={cn(
          'pointer-events-none relative aspect-[5/4] max-w-full overflow-hidden',
          compact ? 'mb-1.5 w-[176px] sm:row-span-4 sm:mb-0' : 'mb-5 w-[min(380px,100%)]'
        )}
      />
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{eyebrow}</p>
      <Title
        className={cn(
          'font-serif leading-[1.15] text-foreground text-balance',
          compact ? 'text-[22px]' : 'text-[26px] sm:text-[30px]'
        )}
      >
        {title}
      </Title>
      <p className={cn('max-w-[46ch] text-sm text-muted text-pretty', compact ? 'mb-2.5 mt-0.5' : 'mb-3.5 mt-1')}>
        {description}
      </p>
      {action && (
        <Button
          variant={compact ? 'secondary' : 'primary'}
          size={compact ? 'sm' : 'default'}
          className="gap-1.5"
          onClick={action.onClick}
          onPointerEnter={preview}
          onPointerLeave={(event) => {
            // A focused button keeps its preview until blur releases it; otherwise
            // leaving the button is leaving the drawing's answer, so it rests.
            if (event.currentTarget === document.activeElement) previewingRef.current = false
            else release()
          }}
          onFocus={preview}
          onBlur={release}
        >
          {action.creates && <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          {action.label}
        </Button>
      )}
    </div>
  )
}
