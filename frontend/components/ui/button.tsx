import * as React from 'react'
import { cn } from '@/lib/utils'

export type ButtonVariant =
  | 'primary'
  | 'destructive'
  | 'transcribe'
  | 'secondary'
  | 'ghost'
  | 'ink'

export type ButtonSize = 'sm' | 'default' | 'icon' | 'lg'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-foreground shadow-xs hover:bg-accent/90',
  destructive: 'bg-destructive text-solid-foreground shadow-xs hover:bg-destructive/90',
  transcribe: 'border border-transcribe-hover bg-transcribe text-solid-foreground shadow-xs hover:bg-transcribe-hover',
  secondary: 'border border-border bg-control text-foreground shadow-xs hover:bg-control-hover',
  ghost: 'bg-transparent text-foreground/60 hover:text-foreground',
  // Text-coloured fill: the one main action on a page (sign-in).
  ink: 'border border-foreground bg-foreground text-background shadow-xs hover:bg-foreground/90',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  default: 'px-4 py-2 text-sm',
  icon: 'h-10 w-10',
  // A full-width 40px button with 15px text (sign-in); a full-width button
  // shrinks less when pressed.
  lg: 'h-10 w-full gap-2.5 px-4 text-[15px] active:scale-[0.985]',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-sm font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
)

Button.displayName = 'Button'
