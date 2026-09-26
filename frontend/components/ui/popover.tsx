"use client"

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor
const PopoverPortal = PopoverPrimitive.Portal

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        'z-50 w-72 rounded-lg border border-border bg-surface p-4 text-current shadow-elevation outline-hidden',
        'data-[state=closed]:animate-[fadeOut_120ms_ease-in] data-[state=open]:animate-[fadeIn_150ms_ease-out]',
        'data-[side=bottom]:animate-[slideDown_150ms_ease-out] data-[side=top]:animate-[slideUp_150ms_ease-out]',
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

/**
 * Keeps its last render while `open` is false. Content that is derived from
 * what the popover was opened for would otherwise re-render empty while the
 * popover fades out.
 */
const PopoverFrozenWhileClosed = React.memo(function PopoverFrozenWhileClosed(
  { children }: { open: boolean; children: React.ReactNode },
) {
  return children
}, (_previous, next) => !next.open)

export { Popover, PopoverTrigger, PopoverAnchor, PopoverPortal, PopoverContent, PopoverFrozenWhileClosed }
