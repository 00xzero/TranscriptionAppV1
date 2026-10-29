'use client'

import * as OneTimePasswordField from '@radix-ui/react-one-time-password-field'
import { cn } from '@/lib/utils'

const LENGTH = 6

interface CodeFieldProps {
  name: string
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
}

/**
 * Six boxes for an emailed code, on Radix's OneTimePasswordField (0.2.1, an
 * unstable preview: this wrapper is the one place to change if its API
 * moves). It takes a pasted code and the phone's one-time-code autofill, and
 * submits its form once all six digits are in.
 */
export function CodeField({ name, disabled, invalid, ...rest }: CodeFieldProps) {
  return (
    <OneTimePasswordField.Root
      name={name}
      autoFocus
      autoSubmit
      disabled={disabled}
      validationType="numeric"
      className="flex justify-center gap-2"
      {...rest}
    >
      {Array.from({ length: LENGTH }, (_, index) => (
        <OneTimePasswordField.Input
          key={index}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-12 w-11 rounded-sm border border-border bg-field/50 text-center font-mono text-xl text-foreground transition-colors',
            'focus:border-accent focus:bg-field focus:outline-hidden disabled:opacity-50',
            'aria-invalid:border-ember-red'
          )}
        />
      ))}
      <OneTimePasswordField.HiddenInput />
    </OneTimePasswordField.Root>
  )
}
