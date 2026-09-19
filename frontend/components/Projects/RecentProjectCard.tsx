'use client'

import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import type { Project } from '@/contracts/db'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { countLabel, formatRelativeTime } from './format'

interface RecentProjectCardProps {
  project: Project
  parentPath: string | null
  lastActivityAt: string
  transcriptCount: number
  nestedProjectCount: number
  /**
   * Branch rollups are labelled "total" so the dashboard never silently disagrees with
   * the direct per-project counts the Projects page shows for the same folder.
   */
  countsAreBranchTotals: boolean
  actions?: ReactNode
}

export function RecentProjectCard({
  project,
  parentPath,
  lastActivityAt,
  transcriptCount,
  nestedProjectCount,
  countsAreBranchTotals,
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
      className="group relative h-full min-h-44 rounded-lg border border-border bg-panel p-5 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-elevation"
    >
      <div className="absolute -top-2.5 left-4 h-4 w-16 rounded-t-sm border-x border-t border-border bg-warm-highlight dark:bg-night-border" />
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-warm-highlight/60 text-ink/55 dark:bg-night-border dark:text-paper/60">
          <Folder className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-muted">
            {formatRelativeTime(lastActivityAt)}
          </span>
          {/* Above the stretched link so the menu takes its own clicks. */}
          {actions && <div className="relative z-10">{actions}</div>}
        </div>
      </div>
      <h4 className="truncate font-serif text-xl italic text-foreground transition-colors group-hover:text-trust-blue">
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
    </div>
  )
}

export function RecentProjectCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-full min-h-44 animate-pulse rounded-lg border border-border bg-panel p-5"
    >
      <div className="h-8 w-8 rounded-sm bg-subtle" />
      <div className="mt-4 h-5 w-2/3 rounded-sm bg-subtle" />
      <div className="mt-2 h-3 w-1/2 rounded-sm bg-subtle" />
      <div className="mt-6 h-3 w-4/5 rounded-sm bg-subtle" />
    </div>
  )
}
