'use client'

import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import type { ProjectSpeakerSummary } from '@/contracts/db'
import type { RecentProjectCardData } from '@/core/projects/activity'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { cn } from '@/lib/utils'
import { countLabel, formatRelativeTime } from './format'
import { SpeakerAvatarGroup } from './SpeakerAvatarGroup'

/**
 * The ranked card data plus what the speaker RPC adds on top of it.
 *
 * Kept separate from `RecentProjectCardData` so `core/projects/activity.ts`
 * stays pure ranking and count logic with nothing fetched in it — but declared
 * here rather than inlined, so the carousel that spreads these onto the card
 * carries the speaker fields in its own types instead of erasing them.
 */
export type RecentProjectCardViewData = RecentProjectCardData & {
  speakerSummary?: ProjectSpeakerSummary
  speakersLoading: boolean
}

type RecentProjectCardProps = RecentProjectCardViewData & {
  actions?: ReactNode
}

export function RecentProjectCard({
  project,
  parentPath,
  lastActivityAt,
  transcriptCount,
  nestedProjectCount,
  countsAreBranchTotals,
  speakerSummary,
  speakersLoading,
  actions,
}: RecentProjectCardProps) {
  const transcriptLabel = countsAreBranchTotals
    ? countLabel(transcriptCount, 'transcript total', 'transcripts total')
    : countLabel(transcriptCount, 'transcript', 'transcripts')

  // The link wraps only the title and stretches its hit area over the card with
  // after:inset-0. Nothing between here and the anchor may be positioned, or the
  // pseudo-element would size itself to that ancestor instead of the whole card.
  return (
    <div
      data-testid={`recent-project-card-${project.id}`}
      className="group relative h-full min-h-52 rounded-lg border border-border bg-panel p-5 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-elevation"
    >
      <div className="absolute -top-2.5 left-4 h-4 w-16 rounded-t-sm border-x border-t border-border bg-warm-highlight dark:bg-night-border" />
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-warm-highlight/60 text-ink/55 dark:bg-night-border dark:text-paper/60">
          <Folder className="h-4 w-4" aria-hidden="true" />
        </div>
        {/* h-8 matches the icon and the menu button so all three share a centre line. */}
        <span className={cn('flex h-8 items-center font-mono text-xs text-muted', actions && 'mr-8')}>
          {formatRelativeTime(lastActivityAt)}
        </span>
      </div>
      {/*
        Newsreader's italic descenders lean backwards, so a title starting with g,
        y or j paints ~1.3px to the LEFT of the text origin -- which truncate's
        overflow:hidden slices off at the content edge. The padding gives that
        overhang somewhere to land and the negative margin cancels it, so the
        title stays aligned with the icon and the counts below it.
      */}
      <h4 className="-ml-1 truncate pl-1 font-serif text-xl italic text-foreground transition-colors group-hover:text-trust-blue">
        <Link
          href={`/projects/${project.id}`}
          title={`Open ${project.name}`}
          className="after:absolute after:inset-0 after:rounded-lg"
        >
          {project.name}
        </Link>
      </h4>
      {parentPath && (
        <p className="mt-1 truncate font-sans text-xs text-muted" title={parentPath}>
          {parentPath}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted">
        <span>{transcriptLabel}</span>
        <span>{countLabel(nestedProjectCount, 'nested project', 'nested projects')}</span>
      </div>
      {/*
        Omitted entirely when the summary could not be loaded — rendering
        "0 speakers" for a failed fetch would state something false. The card's
        min-height reserves the space either way, so nothing reflows.

        The note above the card root is about ANCESTORS of the title link. This
        row is the link's sibling, so the group positioning its own circles
        (see SpeakerAvatarGroup) cannot retarget the ::after — measured: the
        pseudo-element still covers the full card.

        It does mean the circles sit above the stretched hit area and take
        their own clicks, which is what makes their tooltips reachable. `href`
        hands them the same destination so the row is not a dead patch in the
        middle of a clickable card — it must stay in sync with the title link
        above.
      */}
      {(speakersLoading || speakerSummary) && (
        <SpeakerAvatarGroup
          className="mt-3"
          size="card"
          href={`/projects/${project.id}`}
          loading={speakersLoading}
          speakers={speakerSummary?.preview ?? []}
          totalCount={speakerSummary?.speaker_count ?? 0}
        />
      )}
      {/*
        Rendered last so Tab reaches the link before the menu, matching ProjectRow,
        and positioned rather than in flow so it still sits in the top-right corner.
        z-10 lifts it above the link's stretched ::after so it takes its own clicks.
      */}
      {actions && <div className="absolute right-5 top-5 z-10">{actions}</div>}
    </div>
  )
}

export function RecentProjectCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-full min-h-52 animate-pulse rounded-lg border border-border bg-panel p-5"
    >
      <div className="h-8 w-8 rounded-sm bg-subtle" />
      <div className="mt-4 h-5 w-2/3 rounded-sm bg-subtle" />
      <div className="mt-2 h-3 w-1/2 rounded-sm bg-subtle" />
      <div className="mt-6 h-3 w-4/5 rounded-sm bg-subtle" />
      {/* Stands in for the speaker row so the skeleton is the card's real height. */}
      <div className="mt-3 flex">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className={cn('h-7 w-7 rounded-full bg-subtle ring-2 ring-panel', item > 0 && '-ml-1.5')}
          />
        ))}
      </div>
    </div>
  )
}
