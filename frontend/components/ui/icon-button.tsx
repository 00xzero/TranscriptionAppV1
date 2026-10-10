'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type IconButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'aria-label' | 'children'> & {
  /** The action's name: its tooltip, and its accessible name unless `ariaLabel` is given. */
  label: string
  /** A fuller accessible name, where the label alone repeats from row to row. */
  ariaLabel?: string
  icon: ReactNode
  /**
   * Unavailable, with the reason. The button stays focusable and hoverable so
   * its tooltip can say why, which a disabled button could not.
   */
  unavailableReason?: string
  /** Shown pressed while what it opened is open. */
  active?: boolean
}

/**
 * A round icon button that names itself in a tooltip on hover and focus.
 * Forwards its ref and props, so it can be a popover's or a dialog's trigger
 * or close button.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, ariaLabel, icon, unavailableReason, active = false, className, onClick, ...props },
  ref
) {
  const reasonId = useId()
  // Only set when unavailable: an explicit undefined would override the
  // tooltip's own aria-describedby.
  const unavailable = unavailableReason ? { 'aria-disabled': true, 'aria-describedby': reasonId } : {}
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={ariaLabel ?? label}
          {...unavailable}
          onClick={unavailableReason ? (event) => event.preventDefault() : onClick}
          className={cn(
            'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border border-transparent text-foreground/60 transition-colors',
            'hover:border-subtle-border hover:bg-field hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/60',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent',
            'aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-transparent aria-disabled:hover:bg-transparent',
            active && 'border-subtle-border bg-field text-foreground',
            className
          )}
          {...props}
        >
          {icon}
        </button>
      </TooltipTrigger>
      {/* Above dialogs (z-[100]), which these often sit in. */}
      <TooltipContent className="z-[110]">
        {unavailableReason ? `${label} · ${unavailableReason}` : label}
      </TooltipContent>
      {unavailableReason && <span id={reasonId} className="sr-only">{unavailableReason}</span>}
    </Tooltip>
  )
})
