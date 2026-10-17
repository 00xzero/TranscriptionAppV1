'use client'

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { speakerInitials } from '@/lib/speakers/palette'
import { cn } from '@/lib/utils'
import { HiddenBadge } from './HiddenBadge'

type RowPerson = {
  id: string
  name: string
  preferred_color: string
  organisation_name: string | null
  hidden: boolean
}

const ROW = 'group grid min-h-18 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 p-4 transition-colors hover:bg-subtle sm:flex'

/**
 * A person in a list: their face, name and organisation, with the caller's
 * figures on the right. A link where the row navigates (the People list), a
 * button where it opens something in place (a project's people dialog), which
 * also shows a chevron while hovered or focused.
 */
export function PersonRow({ person, stats, open = false, ...target }: {
  person: RowPerson
  /** The right-hand mono lines, as block spans. */
  stats: ReactNode
  /** This person is open beside or over the list. */
  open?: boolean
} & ({ href: string; onClick?: () => void } | { href?: undefined; onClick: () => void })) {
  const content = (
    <>
      <Avatar color={person.preferred_color} className="row-span-2 h-10 min-w-10 self-start text-xs sm:self-center">
        {speakerInitials(person.name)}
      </Avatar>
      {/* Spans, not divs and paragraphs: a button may hold only phrasing content. */}
      <span className="block min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-ink transition-colors group-hover:text-trust-blue dark:text-paper">
          <span className="truncate">{person.name}</span>
          {person.hidden && <HiddenBadge />}
        </span>
        {person.organisation_name && <span className="block truncate text-xs text-muted">{person.organisation_name}</span>}
      </span>
      <span className="col-start-2 block min-w-0 font-mono text-[10px] text-muted sm:shrink-0 sm:text-right">
        {stats}
      </span>
    </>
  )

  if (target.href !== undefined) {
    return (
      <Link
        href={target.href}
        onClick={target.onClick}
        data-testid={`person-row-${person.id}`}
        className={cn(ROW, open && 'bg-subtle')}
      >
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={target.onClick}
      data-testid={`person-row-${person.id}`}
      className={cn(ROW, 'w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60', open && 'bg-subtle')}
    >
      {content}
      <ChevronRight
        aria-hidden="true"
        className="hidden h-4 w-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:block"
      />
    </button>
  )
}
