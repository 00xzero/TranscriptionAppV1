"use client"

import * as React from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cn } from '@/lib/utils'

const VARIANTS = {
  default: '',
  // A small mono option, outlined until it is on: Find and Replace's Match
  // Case, the People list's order and Show hidden.
  outline: cn(
    'h-auto select-none border px-2.5 py-1 font-mono text-[11px]',
    'border-ink/10 text-ink/40 data-[state=off]:hover:bg-ink/5',
    'dark:border-paper/10 dark:text-paper/40 dark:data-[state=off]:hover:bg-paper/5',
    'data-[state=on]:border-trust-blue/30 dark:data-[state=on]:border-trust-blue/40 dark:data-[state=on]:bg-trust-blue/20 dark:data-[state=on]:text-trust-blue'
  ),
} as const

type ToggleProps = React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & {
  variant?: keyof typeof VARIANTS
}

const Toggle = React.forwardRef<React.ElementRef<typeof TogglePrimitive.Root>, ToggleProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <TogglePrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors',
        'hover:bg-[var(--surface-alt)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/30',
        'data-[state=on]:bg-trust-blue/15 data-[state=on]:text-trust-blue',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  )
)
Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle }
