import type { ReactNode } from 'react'
import { SlatSheet } from './SlatSheet'

/**
 * The sign-in pages' frame: the logo and the steps' column on the left and,
 * from 1280px wide, the drawing's card on the right. Narrower, the column
 * stands alone.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 gap-6 bg-background px-4 py-7 text-foreground min-[1280px]:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] min-[1280px]:pr-7">
      <section className="flex min-w-0 flex-col pt-1 pb-4 min-[1280px]:px-4">
        <Logo />
        {/* Pinned from the top rather than centred, at the height that centres
            the first step: the heading stays put from step to step, and a
            message that appears only pushes down what is below it. */}
        <main className="flex flex-1 flex-col items-center pt-[max(3.9625rem,calc(50dvh-16.6625rem))] pb-10">{children}</main>
      </section>
      <SlatSheet className="min-h-[calc(100dvh-3.5rem)]" />
    </div>
  )
}

/** The sidebar's logo, 20% larger. */
function Logo() {
  return (
    <div className="flex items-center gap-3" aria-label="olivetti">
      <span className="flex items-center gap-[7px]" aria-hidden="true">
        <span className="h-[29px] w-[5px] rounded-full bg-ink dark:bg-paper" />
        <span className="h-2.5 w-2.5 rounded-xs bg-ember-red" />
      </span>
      <span className="font-serif text-[1.92rem] leading-none italic tracking-tight text-ink dark:text-paper">olivetti</span>
    </div>
  )
}
