'use client'

import * as React from 'react'
import * as PasswordToggleField from '@radix-ui/react-password-toggle-field'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inputClassName } from './input'

type PasswordFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'autoComplete'> & {
  autoComplete: 'current-password' | 'new-password'
}

/**
 * A password box with a show/hide eye, on Radix's PasswordToggleField
 * (0.2.1, an unstable preview: this wrapper is the one place to change if its
 * API moves). It hides the password again when the form submits.
 */
export const PasswordField = React.forwardRef<HTMLInputElement, PasswordFieldProps>(
  // The id goes on the input itself (the root would make it `${id}-input`),
  // so a <label htmlFor> finds it.
  ({ className, ...props }, ref) => (
    <PasswordToggleField.Root>
      <div className="relative">
        <PasswordToggleField.Input ref={ref} className={cn(inputClassName, 'pr-11', className)} {...props} />
        <PasswordToggleField.Toggle className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <PasswordToggleField.Icon
            className="h-[17px] w-[17px]"
            visible={<EyeOff strokeWidth={1.75} />}
            hidden={<Eye strokeWidth={1.75} />}
          />
        </PasswordToggleField.Toggle>
      </div>
    </PasswordToggleField.Root>
  )
)

PasswordField.displayName = 'PasswordField'
