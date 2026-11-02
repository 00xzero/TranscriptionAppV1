import type { CSSProperties, ReactNode } from 'react'
import type { Tag } from '@/contracts/db'
import { SPEAKER_COLOR_TINTS, type SpeakerColor } from '@/lib/speakers/palette'
import { cn } from '@/lib/utils'

const FALLBACK = SPEAKER_COLOR_TINTS['#64748B']

/** The chip's tint as variables, so `dark:` can pick the night pair. */
function tintStyle(color: string): CSSProperties {
  const tint = SPEAKER_COLOR_TINTS[color as SpeakerColor] ?? FALLBACK
  return {
    '--tag-bg': tint.light.bg,
    '--tag-fg': tint.light.fg,
    '--tag-bg-dark': tint.dark.bg,
    '--tag-fg-dark': tint.dark.fg,
  } as CSSProperties
}

/**
 * A tag as a soft chip: its palette colour as text on a tint of it. `md` sits
 * in the editor and the tag box, `sm` on list rows. Anything passed as
 * children (a remove button) follows the name.
 */
export function TagChip({ tag, size = 'md', className, children }: {
  tag: Pick<Tag, 'name' | 'color'>
  size?: 'sm' | 'md'
  className?: string
  children?: ReactNode
}) {
  return (
    <span
      style={tintStyle(tag.color)}
      className={cn(
        'inline-flex min-w-0 max-w-full shrink-0 items-center gap-0.5 rounded font-sans font-medium whitespace-nowrap',
        'bg-[var(--tag-bg)] text-[var(--tag-fg)] dark:bg-[var(--tag-bg-dark)] dark:text-[var(--tag-fg-dark)]',
        size === 'sm' ? 'h-5 px-1.5 text-xs' : 'h-6 px-2 text-[13px]',
        children ? 'pr-0.5' : null,
        className,
      )}
    >
      <span className="truncate">{tag.name}</span>
      {children}
    </span>
  )
}

/** A row's tags: the first few as chips, then how many more. */
export function TagChipList({ tags, max = 3, className }: {
  tags: readonly Tag[]
  max?: number
  className?: string
}) {
  if (tags.length === 0) return null
  const hidden = tags.length - max
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      <span className="sr-only">Tags:</span>
      {tags.slice(0, max).map((tag) => <TagChip key={tag.id} tag={tag} size="sm" />)}
      {hidden > 0 && (
        <span className="shrink-0 font-sans text-xs text-muted">
          +{hidden}<span className="sr-only"> more: {tags.slice(max).map((tag) => tag.name).join(', ')}</span>
        </span>
      )}
    </span>
  )
}
