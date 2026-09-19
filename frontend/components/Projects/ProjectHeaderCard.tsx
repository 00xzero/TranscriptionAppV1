'use client'

import type { ReactNode } from 'react'
import type { Project } from '@/contracts/db'
import { countLabel, formatRelativeTime } from './format'

interface ProjectHeaderCardProps {
  project: Project
  directTranscriptCount: number
  nestedProjectCount: number
  actions: ReactNode
}

/** A project's landing header, drawn as a folder with a tab on its top edge. */
export function ProjectHeaderCard({
  project,
  directTranscriptCount,
  nestedProjectCount,
  actions,
}: ProjectHeaderCardProps) {
  return (
    <section
      aria-labelledby="project-heading"
      className="relative mt-3 rounded-sm rounded-tl-none border border-border bg-panel px-6 pb-5 pt-6 shadow-xs"
    >
      {/* The tab overlaps the card's top border by 1px so the two read as one shape. */}
      <span
        aria-hidden="true"
        className="absolute -left-px -top-3 h-[13px] w-24 rounded-t-md border border-b-0 border-border bg-panel"
      />
      <div className="flex items-start justify-between gap-6">
        <h1
          id="project-heading"
          className="min-w-0 break-words font-serif text-4xl italic leading-tight text-foreground"
        >
          {project.name}
        </h1>
        <time
          dateTime={project.updated_at}
          title="Last updated"
          className="mt-2 shrink-0 font-sans text-xs text-ink/60 dark:text-paper/60"
        >
          {formatRelativeTime(project.updated_at)}
        </time>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="font-mono text-xs text-muted">
          {countLabel(directTranscriptCount, 'transcript', 'transcripts')} ·{' '}
          {countLabel(nestedProjectCount, 'nested project', 'nested projects')}
        </p>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
    </section>
  )
}
