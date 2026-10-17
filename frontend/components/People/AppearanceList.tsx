'use client'

import type { ReactNode } from 'react'
import { ListRowSkeleton, ProjectList } from '@/components/Projects/ProjectList'
import type { TranscriptProjectLabel } from '@/components/Projects/format'
import type { PersonAppearance } from '@/contracts/db'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { formatPeopleDate, formatTalk } from './format'

/**
 * The transcripts a person appears in, newest first, each opening the editor:
 * its project, date and how much of the talking was theirs. Holds its place
 * with skeleton rows while they load. `action` adds a control to each row.
 */
export function AppearanceList({ rows, error, onRetry, empty, projectLabel, action }: {
  rows: readonly PersonAppearance[] | null
  error: unknown
  onRetry: () => void
  /** Said when the person is in none of them. */
  empty: ReactNode
  /** The row's project line, or null to show none. */
  projectLabel: (projectId: string | null) => TranscriptProjectLabel | null
  action?: (appearance: PersonAppearance, title: string) => ReactNode
}) {
  if (rows === null) {
    return error ? (
      <ProjectList>
        <p className="px-4 py-5 text-sm text-muted">
          Couldn&apos;t load the transcripts.{' '}
          <button type="button" className="text-trust-blue hover:underline" onClick={onRetry}>
            Try again
          </button>
        </p>
      </ProjectList>
    ) : (
      <ProjectList><ListRowSkeleton /><ListRowSkeleton /></ProjectList>
    )
  }
  if (rows.length === 0) {
    return (
      <ProjectList>
        <p className="px-4 py-5 text-sm text-muted">{empty}</p>
      </ProjectList>
    )
  }
  return (
    <ProjectList>
      {rows.map((appearance) => {
        const title = appearance.title || 'Untitled'
        const project = projectLabel(appearance.project_id)
        return (
          <div key={appearance.transcript_id} data-testid={`appearance-${appearance.transcript_id}`}
            className="group flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle">
            <Link href={`/editor/${appearance.transcript_id}`} title={`Open ${title}`} className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink transition-colors group-hover:text-trust-blue dark:text-paper">
                {title}
              </p>
              <p className="truncate font-mono text-[10px] text-ink/50 dark:text-paper/50">
                {project && <span title={project.full}>{project.label} · </span>}
                {formatPeopleDate(appearance.created_at)} · {formatTalk(appearance.talk_ms, appearance.transcript_talk_ms)}
              </p>
            </Link>
            {action?.(appearance, title)}
          </div>
        )
      })}
    </ProjectList>
  )
}
