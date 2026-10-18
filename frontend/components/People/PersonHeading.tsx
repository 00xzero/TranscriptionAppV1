'use client'

import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { speakerInitials } from '@/lib/speakers/palette'
import { HiddenBadge } from './HiddenBadge'

/** DialogTitle's own look, for the plain heading below. */
const TITLE = 'font-serif italic text-ink dark:text-paper break-words text-3xl leading-tight'
const DESCRIPTION = 'mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted'

/**
 * A person's face, name and organisation at the top of a dialog. It is the
 * dialog's title, unless `titleId` is given: a dialog that shows this beside
 * another screen keeps its own title and points aria-labelledby here instead.
 */
export function PersonHeading({ person, details, actions, titleId }: {
  person: { name: string; preferred_color: string; organisation_name: string | null; hidden: boolean }
  /** More of the description line, after the organisation. */
  details?: ReactNode
  actions?: ReactNode
  titleId?: string
}) {
  const description = (
    <>
      <span>{person.organisation_name ?? 'No organisation'}</span>
      {details}
      {person.hidden && <HiddenBadge />}
    </>
  )
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
      <Avatar color={person.preferred_color} className="h-14 min-w-14 text-base">
        {speakerInitials(person.name)}
      </Avatar>
      <div className="min-w-0 flex-1 basis-48">
        {titleId ? (
          <>
            <h2 id={titleId} className={TITLE}>{person.name}</h2>
            <div className={DESCRIPTION}>{description}</div>
          </>
        ) : (
          <>
            <DialogTitle className="break-words text-3xl leading-tight">{person.name}</DialogTitle>
            <DialogDescription asChild>
              <div className={DESCRIPTION}>{description}</div>
            </DialogDescription>
          </>
        )}
      </div>
      {actions}
    </div>
  )
}

/** PersonHeading's shape while the person loads: face, name and organisation as placeholders. */
export function PersonHeadingSkeleton() {
  return (
    <div aria-hidden="true" className="flex items-start gap-4">
      <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-subtle" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-7 w-48 animate-pulse rounded-sm bg-subtle" />
        <div className="h-4 w-32 animate-pulse rounded-sm bg-subtle" />
      </div>
    </div>
  )
}
