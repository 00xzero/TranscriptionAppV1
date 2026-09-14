'use client'

import { ErrorFallback } from '@/components/ErrorFallback'
import { ProjectList, ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { ProjectRow } from '@/components/Projects/ProjectRow'
import { ProjectsEmptyState } from '@/components/Projects/ProjectsEmptyState'
import { TranscriptRow } from '@/components/Projects/TranscriptRow'
import { countLabel } from '@/components/Projects/format'
import {
  descendantCount,
  transcriptCountsByProject,
  transcriptsInProject,
} from '@/core/projects/tree'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { useProjectsLoadState } from '@/lib/projects/useProjectsLoadState'

export default function ProjectsPage() {
  const { tree, transcripts } = useProjectsData()
  const { isLoading, loadError, retry } = useProjectsLoadState()

  if (isLoading) {
    return (
      <div aria-label="Loading projects" className="px-6 pb-10 pt-[80px] md:px-10">
        <ProjectListSkeleton />
      </div>
    )
  }

  if (loadError) {
    return (
      <ErrorFallback
        title="We couldn't load your projects"
        description="The project list is temporarily unavailable. Try loading it again."
        primary={{ kind: 'button', label: 'Try again', onClick: retry }}
        secondary={{ kind: 'link', label: 'Go home', href: '/' }}
      />
    )
  }

  const hasProjects = tree.roots.length > 0
  const unfiled = transcriptsInProject(transcripts, null)
  const isEmpty = !hasProjects && unfiled.length === 0
  const counts = transcriptCountsByProject(transcripts)

  return (
    <div className="space-y-8 px-6 pb-10 pt-[80px] md:px-10">
      <section aria-labelledby="projects-heading">
        <h1
          id="projects-heading"
          className={
            hasProjects
              ? 'mb-3 border-b border-border pb-2 font-serif text-2xl text-foreground'
              : 'sr-only'
          }
        >
          Projects
        </h1>
        {hasProjects && (
          <ProjectList>
            {tree.roots.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                directTranscriptCount={counts.get(project.id) ?? 0}
                nestedProjectCount={descendantCount(tree, project.id)}
              />
            ))}
          </ProjectList>
        )}
        {isEmpty && (
          <ProjectList>
            <ProjectsEmptyState variant="no-projects" />
          </ProjectList>
        )}
      </section>

      {!isEmpty && (
        <section aria-labelledby="unfiled-heading">
          <div className="mb-3 flex items-baseline justify-between border-b border-border pb-2">
            <h2 id="unfiled-heading" className="font-serif text-2xl text-foreground">
              Unfiled
            </h2>
            <span className="font-mono text-xs text-muted">
              {countLabel(unfiled.length, 'transcript', 'transcripts')}
            </span>
          </div>
          <ProjectList>
            {unfiled.length === 0 ? (
              <ProjectsEmptyState variant="empty-unfiled" />
            ) : (
              unfiled.map((transcript) => (
                <TranscriptRow key={transcript.id} transcript={transcript} />
              ))
            )}
          </ProjectList>
        </section>
      )}
    </div>
  )
}
