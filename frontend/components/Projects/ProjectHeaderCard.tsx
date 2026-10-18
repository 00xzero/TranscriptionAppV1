'use client'

import type { ReactNode, Ref } from 'react'
import type { Project, ProjectSpeakerSummary } from '@/contracts/db'
import { previewDisplay } from '@/lib/speakers/display'
import { cn } from '@/lib/utils'
import { countLabel, formatRelativeTime } from './format'
import { SpeakerAvatarGroup } from './SpeakerAvatarGroup'

interface ProjectHeaderCardProps {
  project: Project
  directTranscriptCount: number
  nestedProjectCount: number
  /**
   * Speakers of this project and every project nested in it, as its people
   * dialog lists them.
   */
  speakerSummary?: ProjectSpeakerSummary
  speakersLoading: boolean
  /** Opens the people dialog; the faces become its button once there is someone to show. */
  onOpenSpeakers?: () => void
  speakersOpen?: boolean
  speakersButtonRef?: Ref<HTMLButtonElement>
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
  onOpenSpeakers,
  speakersOpen = false,
  speakersButtonRef,
  actions,
  menu,
}: ProjectHeaderCardProps) {
  const speakerCount = speakerSummary?.speaker_count ?? 0
  const speakersClickable = Boolean(onOpenSpeakers && !speakersLoading && speakerSummary && speakerCount > 0)
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
        {/* Counts and avatars share one row wherever they fit, so the card keeps
            its height. Below a 448px row the avatars always take a line beneath
            instead, loading or not: the loaded faces (with their badge and the
            button's padding) are wider than the placeholder, so letting them
            wrap only once they fit no longer would make the card jump as they
            arrive. Above it, the widest counts and faces fit side by side. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 @max-md:flex-col @max-md:items-start">
          <p className="font-mono text-xs text-muted">
            {countLabel(directTranscriptCount, 'transcript', 'transcripts')} ·{' '}
            {countLabel(nestedProjectCount, 'nested project', 'nested projects')}
          </p>
          {/* Dropped entirely on failure: "0 speakers" would be a false claim. */}
          {speakersClickable ? (
            // Styled as the editor's speaker button. Where the row is too narrow
            // to share, it sits beneath the counts rather than hiding.
            <button
              ref={speakersButtonRef}
              type="button"
              onClick={onOpenSpeakers}
              aria-haspopup="dialog"
              aria-expanded={speakersOpen}
              aria-label={`Speakers in ${project.name}: ${countLabel(speakerCount, 'speaker', 'speakers')}`}
              className={cn(
                '-my-1 inline-flex cursor-pointer items-center rounded-full py-1 pl-1 pr-2.5 transition-colors',
                'hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/60',
                speakersOpen && 'bg-subtle'
              )}
            >
              <SpeakerAvatarGroup
                size="header"
                interactive
                speakers={(speakerSummary?.preview ?? []).map(previewDisplay)}
                totalCount={speakerCount}
              />
            </button>
          ) : (speakersLoading || speakerSummary) && (
            <SpeakerAvatarGroup
              size="header"
              loading={speakersLoading}
              speakers={(speakerSummary?.preview ?? []).map(previewDisplay)}
              totalCount={speakerCount}
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
