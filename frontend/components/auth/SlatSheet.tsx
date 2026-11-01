'use client'

import { lazy, Suspense, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/** The slats show beside the sign-in form only from this width. */
const WIDE = '(min-width: 1280px)'

const MicroSlats = lazy(() => import('./MicroSlats'))

/**
 * The sign-in page's drawing: a rounded card holding a sea of tiny slats that
 * rolls on its own and stirs under the pointer. The card is laid out on the
 * server and hidden below 1280px; the slats' code loads only once the window
 * is that wide, so phones and narrow windows never fetch it.
 */
export function SlatSheet({ className }: { className?: string }) {
  const [wide, setWide] = useState(false)

  useEffect(() => {
    const query = matchMedia(WIDE)
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative hidden self-stretch overflow-hidden rounded-[20px] border border-border/70 bg-surface min-[1280px]:block',
        className,
      )}
    >
      {wide && (
        <Suspense fallback={null}>
          <MicroSlats className="absolute! inset-0" color="#c87236" backgroundColor="transparent" />
        </Suspense>
      )}
    </div>
  )
}
