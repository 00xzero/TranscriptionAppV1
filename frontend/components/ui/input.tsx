import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full rounded-sm border border-border bg-field/50 px-3 py-2 text-sm text-foreground transition-colors placeholder:text-foreground/30 focus:border-accent focus:bg-field focus:outline-hidden disabled:opacity-50',
      className
    )}
    {...props}
  />
))

Input.displayName = 'Input'
