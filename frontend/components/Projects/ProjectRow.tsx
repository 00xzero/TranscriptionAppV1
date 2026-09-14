'use client'

import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import type { Project } from '@/contracts/db'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { formatRelativeTime } from './format'

interface ProjectRowProps {
  project: Project
  directTranscriptCount: number
  nestedProjectCount: number
  actions?: ReactNode
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function ProjectRow({
  project,
  directTranscriptCount,
  nestedProjectCount,
  actions,
}: ProjectRowProps) {
  const isDeleting = project.deleting_at !== null
  const content = (
    <>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-warm-highlight/60 text-ink/55 dark:bg-night-border dark:text-paper/60">
        <Folder className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-sans text-sm font-medium text-ink transition-colors group-hover:text-trust-blue dark:text-paper">
            {project.name}
          </p>
          {isDeleting && (
            <span className="rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[9px] text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Deleting…
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] text-ink/50 dark:text-paper/50">
          {countLabel(directTranscriptCount, 'transcript', 'transcripts')} ·{' '}
          {countLabel(nestedProjectCount, 'nested project', 'nested projects')}
        </p>
      </div>
    </>
  )

  return (
    <div
      data-testid={`project-row-${project.id}`}
      className="group flex min-h-18 items-center justify-between p-4 transition-colors hover:bg-subtle"
    >
      {isDeleting ? (
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {content}
        </div>
      ) : (
        <Link
          href={`/projects/${project.id}`}
          title={`Open ${project.name}`}
          className="flex min-w-0 flex-1 items-center gap-4"
        >
          {content}
        </Link>
      )}
      <div className="flex items-center gap-4">
        <span className="hidden font-sans text-xs text-ink/60 md:block dark:text-paper/60">
          {formatRelativeTime(project.updated_at)}
        </span>
        {actions}
      </div>
    </div>
  )
}
