"use client"

import * as React from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cn } from '@/lib/utils'

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root>
>(({ className, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors',
      'hover:bg-[var(--surface-alt)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/30',
      'data-[state=on]:bg-trust-blue/15 data-[state=on]:text-trust-blue',
      'disabled:pointer-events-none disabled:opacity-50',
      className
    )}
    {...props}
  />
))
Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle }
