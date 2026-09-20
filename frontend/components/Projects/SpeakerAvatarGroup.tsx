'use client'

import type { ProjectSpeakerPreview } from '@/contracts/db'
import { resolveSpeakerColor, speakerInitials } from '@/lib/speakers/palette'
import { cn } from '@/lib/utils'
import { countLabel } from './format'

type SpeakerAvatarGroupProps = {
  speakers: ProjectSpeakerPreview[]
  totalCount: number
  size: 'card' | 'header'
  loading?: boolean
  className?: string
}

/** Four circles fit; beyond that the fourth slot becomes the "+N" badge. */
const MAX_AVATARS = 4

/**
 * Overlap is capped by legibility, not taste: each circle covers the right edge
 * of the one before it, so the overlap must stay under the free margin beside
 * two-character initials — about (size - glyphWidth) / 2. At 28px that is ~7px,
 * so 6px is safe; at 24px it is ~5.5px, so 6px clips the trailing letter and the
 * header steps down to 4px.
 */
const SIZES = {
  card: { circle: 'h-7 w-7 text-[10px]', row: 'min-h-7', overlap: '-ml-1.5', count: 'font-serif text-xs italic', group: '' },
  // In the header the group shares a row with the counts and the action buttons,
  // so the count text drops out when that row is tight rather than wrapping the
  // group onto a second line and making the card taller. The full count stays in
  // the group's accessible name either way.
  //
  // A CONTAINER query, not a viewport one: the header card sits behind a nav rail
  // and the project archive panel, so its row is only 719px on a 1440px screen.
  // A viewport breakpoint would call that "desktop" and keep the text, which is
  // exactly the case that pushed the action buttons onto a second row.
  //
  // 3xl (768px) is measured, not picked. Row width needed to fit counts, avatars,
  // label and the action buttons on one line:
  //     "1 transcript · 1 nested project"      728px
  //     "12 transcripts · 3 nested projects"   750px
  //     "128 transcripts · 34 nested projects" 764px
  // So 768 clears the worst realistic case by 4px. Anything lower shows the label
  // at widths where ordinary double-digit counts still wrap: at 2xl (672) the
  // 719px row renders the label and the header grows 135px -> 171px, which makes
  // the card's height depend on how many transcripts it happens to hold.
  header: {
    circle: 'h-6 w-6 text-[9px]',
    row: 'min-h-6',
    overlap: '-ml-1',
    count: 'font-mono text-xs @max-3xl:hidden',
    // Below @sm the counts alone fill the row (223px of 244px at 390px), so the
    // group cannot share the line. The alternatives were worse: wrapping adds a
    // second row and ~32px of header, and truncating the counts would drop real
    // information for decorative circles. So the group steps aside entirely, and
    // the header reads exactly as it did before this feature. Mobile still gets
    // avatars on the Library cards, which have a row of their own.
    group: '@max-sm:hidden',
  },
} as const

function accessibleName(visible: ProjectSpeakerPreview[], totalCount: number): string {
  const count = countLabel(totalCount, 'speaker', 'speakers')
  if (totalCount === 0) return count

  const names = visible.map((speaker) => speaker.label.trim() || 'Unnamed speaker')
  const remainder = totalCount - visible.length
  const parts = remainder > 0 ? [...names, `${remainder} more`] : names
  if (parts.length === 0) return count

  const joined =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `${count}: ${joined}`
}

/**
 * Who is in a project, as overlapping initial circles.
 *
 * Informational only — never a button, never a tab stop, and never navigates.
 * It also must not become a positioned element: RecentProjectCard stretches its
 * title link with `after:inset-0`, and any positioned ancestor between the card
 * root and that anchor would resize the pseudo-element and break the card's
 * click target.
 */
export function SpeakerAvatarGroup({
  speakers,
  totalCount,
  size,
  loading = false,
  className,
}: SpeakerAvatarGroupProps) {
  const styles = SIZES[size]

  if (loading) {
    // Same height as the loaded row, so nothing shifts when the data lands.
    return (
      <div
        aria-hidden="true"
        className={cn('flex items-center gap-2', styles.row, styles.group, className)}
        data-testid="speaker-avatar-group-loading"
      >
        <div className="flex">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className={cn(
                'animate-pulse rounded-full bg-subtle ring-2 ring-panel',
                styles.circle,
                item > 0 && styles.overlap
              )}
            />
          ))}
        </div>
      </div>
    )
  }

  // Exactly four speakers get four circles; a fifth would not fit, so from five
  // up the last slot is spent on the overflow badge instead.
  const visible = totalCount > MAX_AVATARS ? speakers.slice(0, MAX_AVATARS - 1) : speakers.slice(0, MAX_AVATARS)
  const overflow = totalCount - visible.length

  return (
    <div
      role="img"
      aria-label={accessibleName(visible, totalCount)}
      className={cn('flex items-center gap-2', styles.row, styles.group, className)}
      data-testid="speaker-avatar-group"
    >
      {/* aria-hidden throughout: the group's own label already says all of this,
          and leaving it exposed makes some readers announce the count twice. */}
      {visible.length > 0 && (
        <div className="flex" aria-hidden="true">
          {visible.map((speaker, index) => (
            <div
              key={speaker.id}
              title={speaker.label}
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full font-semibold text-solid-foreground ring-2 ring-panel',
                styles.circle,
                index > 0 && styles.overlap
              )}
              style={{ backgroundColor: resolveSpeakerColor(speaker, speaker.paletteIndex) }}
            >
              {speakerInitials(speaker.label)}
            </div>
          ))}
          {overflow > 0 && (
            <div
              className={cn(
                // text-foreground rather than text-muted: muted on surface-alt is
                // about 3.6:1, which is under AA for type this small.
                'flex shrink-0 items-center justify-center rounded-full bg-surface-alt font-semibold text-foreground ring-2 ring-panel',
                styles.circle,
                styles.overlap
              )}
            >
              +{overflow}
            </div>
          )}
        </div>
      )}
      <span className={cn(styles.count, 'text-muted')} aria-hidden="true">
        {countLabel(totalCount, 'speaker', 'speakers')}
      </span>
    </div>
  )
}
