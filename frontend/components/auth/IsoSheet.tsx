'use client'

import { useEffect, useRef, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/** The drawing shows beside the sign-in form only from this width. */
const WIDE = '(min-width: 1280px)'

// The paper fades out before the card's edge, so the sheet lies inside the card.
const FADE = 'transparent, #000 72px, #000 calc(100% - 72px), transparent'
const MASK = `linear-gradient(to right, ${FADE}), linear-gradient(to bottom, ${FADE})`
const maskStyle: CSSProperties = {
  maskImage: MASK,
  maskComposite: 'intersect',
  WebkitMaskImage: MASK,
  WebkitMaskComposite: 'source-in',
}

/**
 * The sign-in page's drawing: a rounded card holding an isometric sheet of
 * graph paper that rises under the pointer. The card is laid out on the
 * server and hidden below 1280px; the drawing's code loads only once the
 * window is that wide, so phones and narrow windows never fetch it.
 */
export function IsoSheet({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const wide = matchMedia(WIDE)
    let sheet: { destroy(): void } | null = null
    // Bumped whenever the drawing should stop, so a load that lands late is dropped.
    let generation = 0

    const sync = () => {
      const current = ++generation
      sheet?.destroy()
      sheet = null
      if (!wide.matches) return
      void import('./iso-sheet').then(({ mountIsoSheet }) => {
        if (current === generation) sheet = mountIsoSheet(canvas)
      })
    }

    sync()
    wide.addEventListener('change', sync)
    return () => {
      generation++
      wide.removeEventListener('change', sync)
      sheet?.destroy()
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative hidden self-stretch overflow-hidden rounded-[20px] border border-border/70 bg-surface min-[1280px]:block',
        className,
      )}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block size-full touch-pan-y" style={maskStyle} />
    </div>
  )
}
