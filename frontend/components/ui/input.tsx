import * as React from 'react'
import { cn } from '@/lib/utils'

/** The text field's look, shared with fields built on other primitives. */
export const inputClassName = cn(
  'w-full rounded-sm border border-border bg-field/50 px-3 py-2 text-sm text-foreground transition-colors placeholder:text-foreground/30 focus:border-accent focus:bg-field focus:outline-hidden disabled:opacity-50',
  'aria-invalid:border-ember-red aria-invalid:focus:border-ember-red'
)

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClassName, className)} {...props} />
))

Input.displayName = 'Input'
