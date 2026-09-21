'use client'

import type { ReactNode } from 'react'
import type { Project, ProjectSpeakerSummary } from '@/contracts/db'
import { countLabel, formatRelativeTime } from './format'
import { SpeakerAvatarGroup } from './SpeakerAvatarGroup'

interface ProjectHeaderCardProps {
  project: Project
  directTranscriptCount: number
  nestedProjectCount: number
  /**
   * Speakers of this project's DIRECT transcripts, matching
   * `directTranscriptCount`. A nested project's speakers belong to its own page.
   */
  speakerSummary?: ProjectSpeakerSummary
  speakersLoading: boolean
  actions: ReactNode
  /** The project's kebab menu, kept flush with the row kebabs below the card. */
  menu: ReactNode
}

/** A project's landing header, drawn as a folder with a tab on its top edge. */
export function ProjectHeaderCard({
  project,
  directTranscriptCount,
  nestedProjectCount,
  speakerSummary,
  speakersLoading,
  actions,
  menu,
}: ProjectHeaderCardProps) {
  return (
    <section
      aria-labelledby="project-heading"
      className="relative mt-3 rounded-sm rounded-tl-none border border-border bg-panel px-4 pb-5 pt-6 shadow-xs sm:px-6"
    >
      {/* The tab overlaps the card's top border by 1px so the two read as one shape. */}
      <span
        aria-hidden="true"
        className="absolute -left-px -top-3 h-[13px] w-24 rounded-t-md border border-b-0 border-border bg-panel"
      />
      {/* Below `sm` the timestamp stacks above the title so short names don't wrap early. */}
      <div className="flex flex-col-reverse items-start gap-1 sm:flex-row sm:justify-between sm:gap-6">
        <h1
          id="project-heading"
          className="min-w-0 break-words font-serif text-3xl italic leading-tight text-foreground sm:text-4xl"
        >
          {project.name}
        </h1>
        <time
          dateTime={project.updated_at}
          title="Last updated"
          className="shrink-0 font-sans text-xs text-ink/60 sm:mt-2 dark:text-paper/60"
        >
          {formatRelativeTime(project.updated_at)}
        </time>
      </div>
      {/* @container so the speaker count text can respond to THIS row's width
          rather than the viewport's — see SpeakerAvatarGroup's header size. */}
      <div className="@container mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {/* Counts and avatars share one row so the card keeps its height; the
            avatar group is never a second row of its own. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <p className="font-mono text-xs text-muted">
            {countLabel(directTranscriptCount, 'transcript', 'transcripts')} ·{' '}
            {countLabel(nestedProjectCount, 'nested project', 'nested projects')}
          </p>
          {/* Dropped entirely on failure: "0 speakers" would be a false claim. */}
          {(speakersLoading || speakerSummary) && (
            <SpeakerAvatarGroup
              size="header"
              loading={speakersLoading}
              speakers={speakerSummary?.preview ?? []}
              totalCount={speakerSummary?.speaker_count ?? 0}
            />
          )}
        </div>
        {/* The kebab keeps to the right edge, and the negative margin cancels the card's
            wider padding, so it lines up with the row kebabs 16px from the card edge. */}
        <div className="flex w-full flex-wrap items-center gap-2 whitespace-nowrap sm:-mr-2 sm:w-auto sm:flex-nowrap">
          {actions}
          <span className="ml-auto sm:ml-0">{menu}</span>
        </div>
      </div>
    </section>
  )
}
