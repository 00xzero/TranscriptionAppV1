'use client'

import type { ReactNode } from 'react'
import { Ghost } from 'lucide-react'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { Avatar } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PreviewDisplay } from '@/lib/speakers/display'
import { cn } from '@/lib/utils'
import { countLabel } from './format'

type SpeakerAvatarGroupProps = {
  /** Already resolved: projects map their preview with `previewDisplay`, the editor builds its own. */
  speakers: PreviewDisplay[]
  totalCount: number
  size: 'card' | 'header' | 'editor'
  loading?: boolean
  className?: string
  /**
   * Where the surrounding card navigates, when it navigates at all.
   *
   * The row has to take pointer events or the tooltips never open, and pointer
   * events are all-or-nothing — there is no CSS that accepts hover and passes
   * clicks through. So on a surface that is itself a link, the row carries the
   * same destination rather than becoming a hole in it. A real anchor, not an
   * onClick: that keeps cmd-click, middle-click and "copy link address"
   * working, which a handler would quietly drop. Omitted on the header, which
   * does not navigate.
   */
  href?: string
  /** A button around the group opens something, so the circles show a hand. */
  interactive?: boolean
}

/**
 * Near-instant, matching the collapsed sidebar (Sidebar.tsx) for the same
 * reason: two initials are not a name, so the circle says nothing at all until
 * the tooltip arrives and the app's 700ms default (app/layout.tsx) reads as
 * broken. The skip window then covers the rest of the row, so sweeping across
 * four faces opens each one instantly instead of re-waiting per circle.
 */
const TOOLTIP_DELAY_MS = 150
const TOOLTIP_SKIP_DELAY_MS = 400

/**
 * TooltipContent is `bg-[var(--surface)]`, and in dark mode `--panel` resolves
 * to the same night-surface — so over a project card the chip is exactly the
 * colour of the thing behind it (measured: rgb(29,30,24) on rgb(29,30,24)) and
 * reads as text floating on the card. Every other tooltip in the app opens over
 * the page background, which is why this only bites here. A border off the
 * existing token restores the edge without touching the shared primitive.
 */
const TOOLTIP_ON_CARD = 'border border-border'

/** The ring separates overlapping circles. The cursor is set per surface; see `href`. */
const CIRCLE_RING = 'ring-2'

/** A circle's square hover target; see the note on the row. */
const HIT_AREA = 'inline-flex shrink-0'

/**
 * Said instead of "0 speakers", which is a true but joyless way to describe a
 * project nobody has spoken in yet. The ghost is lucide's, so it paints in
 * currentColor and needs no per-theme handling — it inherits text-muted and is
 * legible on paper and on night-surface alike.
 */
const EMPTY_COPY = 'No speakers yet!'

/**
 * Overlap is capped by legibility, not taste: each circle covers the right edge
 * of the one before it, so the overlap must stay under the free margin beside
 * two-character initials — about (size - glyphWidth) / 2. At 28px that is ~7px,
 * so 6px is safe; at 24px it is ~5.5px, so 6px clips the trailing letter and the
 * header steps down to 4px.
 */
const SIZES = {
  // Four circles fit on a card or a project header; beyond that the fourth slot
  // becomes the "+N" badge, so `facesWithOverflow` is one fewer than `maxFaces`.
  card: { avatar: 'md', row: 'min-h-7', overlap: '-ml-1.5', count: 'font-serif text-xs italic', ghost: 'h-4 w-4', group: '', ring: 'ring-panel', maxFaces: 4, facesWithOverflow: 3 },
  // In the header the group shares a row with the counts and the action buttons,
  // so the count text drops out when that row is tight rather than wrapping the
  // group onto a second line and making the card taller; only on a narrow row,
  // where even the faces might not fit, does the header put the group on a line
  // of its own (ProjectHeaderCard). The full count stays in the group's
  // accessible name either way.
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
    avatar: 'sm',
    row: 'min-h-6',
    overlap: '-ml-1',
    count: 'font-mono text-xs @max-3xl:hidden',
    ghost: 'h-3.5 w-3.5',
    // Below @sm the counts alone fill the row (223px of 244px at 390px), so the
    // group goes onto a line of its own beneath them. It once stepped aside
    // there instead, saving ~32px of header, but the faces are now the button
    // that opens the project's people dialog, and hiding them would leave
    // phones no way in.
    group: '',
    ring: 'ring-panel',
    maxFaces: 4,
    facesWithOverflow: 3,
  },
  // The editor header's speaker button. Its meta row has the room for four
  // faces and the badge, and the talk-share bar beside it stands in for the
  // count text, which the accessible name still carries. It sits on the page,
  // not a card, so its rings take the page colour.
  editor: { avatar: 'sm', row: 'min-h-6', overlap: '-ml-1', count: 'hidden', ghost: 'h-3.5 w-3.5', group: '', ring: 'ring-background', maxFaces: 4, facesWithOverflow: 4 },
} as const

function accessibleName(visible: PreviewDisplay[], totalCount: number): string {
  // One string for both paths, so the label can never drift from the copy.
  if (totalCount === 0) return EMPTY_COPY
  const count = countLabel(totalCount, 'speaker', 'speakers')

  // The tooltip text, so a voice is named with its transcript here too.
  const names = visible.map((speaker) => speaker.tooltip)
  const remainder = totalCount - visible.length
  const parts = remainder > 0 ? [...names, `${remainder} more`] : names
  if (parts.length === 0) return count

  const joined =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `${count}: ${joined}`
}

/**
 * The circle row. An anchor on a surface that navigates, a plain div otherwise.
 *
 * aria-hidden with tabIndex -1 on purpose: this is a duplicate of a link the
 * surface already has, so exposing it would announce the destination twice and
 * add up to four tab stops per card ahead of its menu button. Hiding it also
 * keeps it clear of the "focusable element inside aria-hidden" trap -- there is
 * nothing focusable inside it, and it is not focusable itself.
 */
function Row({ href, children }: { href?: string; children: ReactNode }) {
  const className = 'relative z-10 flex'
  if (!href) {
    return (
      <div className={className} aria-hidden="true">
        {children}
      </div>
    )
  }
  return (
    // draggable={false}: without it a drag off a circle peels away the browser's
    // link-drag ghost, which looks broken on what reads as an avatar.
    <Link
      href={href}
      className={className}
      aria-hidden="true"
      tabIndex={-1}
      draggable={false}
    >
      {children}
    </Link>
  )
}

/**
 * Who is in a project, as overlapping initial circles.
 *
 * Informational only — never a button, never a tab stop, never announced. On a
 * surface that is itself a link the row carries that same link (see `href`), so
 * a click here behaves like a click anywhere else on the card rather than
 * landing on nothing.
 *
 * The circle row IS positioned, deliberately, so it clears the card's stretched
 * title link and can be hovered; see the note on it below. That is safe only
 * because the group is the anchor's sibling — nothing here may become a
 * positioned ANCESTOR of that anchor, which would resize its `after:inset-0`
 * and shrink the card's click target to this row.
 */
export function SpeakerAvatarGroup({
  speakers,
  totalCount,
  size,
  loading = false,
  className,
  href,
  interactive = false,
}: SpeakerAvatarGroupProps) {
  const styles = SIZES[size]
  // A hand where clicking does something (a card's link, the speaker button
  // around the group in the editor or a project header), a plain arrow
  // otherwise. Never a text caret: an I-beam would say the initials are
  // copyable prose.
  const cursorClass = href || size === 'editor' || interactive ? 'cursor-pointer' : 'cursor-default'

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
            <Avatar
              key={item}
              size={styles.avatar}
              className={cn('animate-pulse bg-subtle', CIRCLE_RING, styles.ring, item > 0 && styles.overlap)}
            />
          ))}
        </div>
      </div>
    )
  }

  // On a card exactly four speakers get four circles; a fifth would not fit, so
  // from five up the last slot is spent on the overflow badge instead.
  const visible = totalCount > styles.maxFaces
    ? speakers.slice(0, styles.facesWithOverflow)
    : speakers.slice(0, styles.maxFaces)
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
        /*
          relative z-10 for the same reason RecentProjectCard's action menu has
          it: the card's title link stretches a ::after over the whole card, and
          a statically positioned row paints below it, so the circles never
          receive the pointer. Measured before this change, elementFromPoint at
          every circle's centre returned the anchor -- which is why the old
          `title` attribute here never showed a speaker's name on a card, only
          the link's own "Open <project>".

          This is safe for the ::after itself: it belongs to the anchor, whose
          nearest positioned ancestor is still the card root. This row is the
          anchor's SIBLING, not its ancestor, so it cannot become that
          containing block.

          Taking the pointer means taking the click, so on a card the row is
          itself an anchor to the same place: hovering names people, clicking
          still opens the project, and touch -- which gets nothing from a
          tooltip -- behaves exactly as the rest of the card does. It stays out
          of the tab order and out of the accessibility tree, because the title
          link already says all of this for keyboard and screen-reader users.
        */
        // disableHoverableContent: these tooltips hold nothing to click, and the
        // grace area that keeps a tooltip open while the pointer heads for it
        // also blocks every other trigger. A wide name above the row sits over
        // its neighbours, so sliding along the circles kept the first name up.
        <TooltipProvider
          delayDuration={TOOLTIP_DELAY_MS}
          skipDelayDuration={TOOLTIP_SKIP_DELAY_MS}
          disableHoverableContent
        >
          <Row href={href}>
            {/*
              Each trigger is a square around its circle, not the circle itself.
              Hit testing follows border-radius, so round triggers left dead
              slivers above and below the centre line where neighbours overlap,
              and a slow pointer drifting through one closed a name and reopened
              the next. Squares meet edge to edge, so the handover is seamless.
            */}
            {visible.map((speaker, index) => (
              <Tooltip key={speaker.key}>
                <TooltipTrigger asChild>
                  <span className={cn(HIT_AREA, cursorClass, index > 0 && styles.overlap)}>
                    {/* People first, in their preferred colours; unlinked voices
                        follow in grey: the editor's colour rules (spec §8). */}
                    <Avatar size={styles.avatar} color={speaker.color} className={cn(CIRCLE_RING, styles.ring)}>
                      {speaker.avatarText}
                    </Avatar>
                  </span>
                </TooltipTrigger>
                <TooltipContent className={TOOLTIP_ON_CARD}>{speaker.tooltip}</TooltipContent>
              </Tooltip>
            ))}
            {overflow > 0 && (
              // The preview is capped at four speakers (see the RPC), so past that
              // the hidden names are not in the payload and the badge can only
              // count them. Naming the one spare preview entry would imply the
              // tooltip lists the overflow when it cannot.
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn(HIT_AREA, cursorClass, styles.overlap)}>
                    <Avatar
                      size={styles.avatar}
                      className={cn(
                        CIRCLE_RING,
                        styles.ring,
                        // bg-border, not bg-surface-alt. In dark mode surface-alt
                        // is #141414 against a #1D1E18 card -- 1.09:1 -- so the
                        // disc was invisible and the badge read as a SMALLER
                        // circle than its neighbours when it is in fact the same
                        // 28px. The border token steps away from the card in both
                        // themes (#333333 on night-surface, #D1CEC5 on white),
                        // and text-foreground clears AA on either.
                        'bg-border text-foreground'
                      )}
                    >
                      +{overflow}
                    </Avatar>
                  </span>
                </TooltipTrigger>
                <TooltipContent className={TOOLTIP_ON_CARD}>
                  {countLabel(overflow, 'more speaker', 'more speakers')}
                </TooltipContent>
              </Tooltip>
            )}
          </Row>
        </TooltipProvider>
      )}
      {/*
        The empty state travels as one unit: on the header `styles.count` drops
        the text below @3xl, and a lone unexplained ghost is worse than nothing,
        so the icon lives inside the same span and leaves with it.
      */}
      <span
        className={cn(styles.count, 'text-muted', totalCount === 0 && 'flex items-center gap-1.5')}
        aria-hidden="true"
      >
        {totalCount === 0 ? (
          <>
            <Ghost className={cn('shrink-0', styles.ghost)} />
            {EMPTY_COPY}
          </>
        ) : (
          countLabel(totalCount, 'speaker', 'speakers')
        )}
      </span>
    </div>
  )
}
