"use client"

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

/** A thin track that fills with the accent; a null value is indeterminate. */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, max = 100, ...props }, ref) => {
  const fraction = value == null || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max))
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={value}
      max={max}
      className={cn('relative h-[3px] w-full overflow-hidden bg-border', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full bg-accent transition-transform duration-200 ease-linear motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - fraction * 100}%)` }}
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
