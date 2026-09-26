import * as React from 'react'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: 'h-6 min-w-6 px-0.5 text-[9px]',
  md: 'h-7 min-w-7 px-1 text-[10px]',
} as const

type AvatarProps = React.ComponentPropsWithRef<'span'> & {
  size?: keyof typeof SIZES
  /** The fill. Omit it to set the fill with a class instead. */
  color?: string
}

/**
 * A circle of initials, or an icon, on a colour. Decorative: whatever sits
 * beside it names who it is.
 *
 * select-none because these are pictures of people, not text: without it the
 * initials drag-select like a caption and the caret turns into an I-beam.
 */
export function Avatar({ size = 'md', color, className, style, ...props }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-solid-foreground',
        SIZES[size],
        className
      )}
      style={color ? { backgroundColor: color, ...style } : style}
      {...props}
    />
  )
}
