'use client'

import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import type { Project } from '@/contracts/db'
import { ListRow } from './ProjectList'
import { countLabel } from './format'

interface ProjectRowProps {
  project: Project
  directTranscriptCount: number
  nestedProjectCount: number
  actions?: ReactNode
}

export function ProjectRow({
  project,
  directTranscriptCount,
  nestedProjectCount,
  actions,
}: ProjectRowProps) {
  const isDeleting = project.deleting_at !== null

  return (
    <ListRow
      testId={`project-row-${project.id}`}
      href={isDeleting ? undefined : `/projects/${project.id}`}
      title={`Open ${project.name}`}
      updatedAt={project.updated_at}
      actions={actions}
    >
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
    </ListRow>
  )
}
