'use client'

import { ErrorFallback } from '@/components/ErrorFallback'
import { TranscriptActionsMenu } from '@/components/TranscriptActionsMenu'
import { TranscriptActionDialogs } from '@/components/TranscriptActionDialogs'
import { Button } from '@/components/ui/button'
import { ProjectActionDialogs } from '@/components/Projects/ProjectActionDialogs'
import { ProjectActionsMenu } from '@/components/Projects/ProjectActionsMenu'
import { ListSectionHeading, ProjectList, ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { ProjectRow } from '@/components/Projects/ProjectRow'
import { ProjectsEmptyState } from '@/components/Projects/ProjectsEmptyState'
import { TranscriptRow } from '@/components/Projects/TranscriptRow'
import { countLabel } from '@/components/Projects/format'
import {
  descendantCount,
  transcriptCountsByProject,
  transcriptsInProject,
} from '@/core/projects/tree'
import { useProjectsData, useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { useProjectActions } from '@/lib/projects/useProjectActions'
import { useProjectsLoadState } from '@/lib/projects/useProjectsLoadState'
import { transcriptActionTarget } from '@/lib/transcripts/actions'
import { useTranscriptActions } from '@/lib/transcripts/useTranscriptActions'

export default function ProjectsPage() {
  const { tree } = useProjectsData()
  const { transcripts } = useTranscriptsData()
  const { isLoading, loadError, retry } = useProjectsLoadState()
  const projectActions = useProjectActions()
  const transcriptActions = useTranscriptActions()

  if (isLoading) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading projects…</span>
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
    <div className="space-y-8">
      <section aria-labelledby="projects-heading">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
          <h1 id="projects-heading" className="font-serif text-2xl text-foreground">Projects</h1>
          <Button size="sm" variant="secondary" onClick={() => projectActions.openCreate(null)}>New Project</Button>
        </div>
        {hasProjects && (
          <ProjectList>
            {tree.roots.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                directTranscriptCount={counts.get(project.id) ?? 0}
                nestedProjectCount={descendantCount(tree, project.id)}
                actions={(
                  <ProjectActionsMenu
                    project={project}
                    onRename={() => projectActions.openRename(project)}
                    onDelete={() => projectActions.openDelete(project)}
                  />
                )}
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
        <section
          id="unfiled"
          aria-labelledby="unfiled-heading"
          className="scroll-mt-[var(--header-height)]"
        >
          <ListSectionHeading
            id="unfiled-heading"
            title="Unfiled"
            meta={countLabel(unfiled.length, 'transcript', 'transcripts')}
          />
          <ProjectList>
            {unfiled.length === 0 ? (
              <ProjectsEmptyState variant="empty-unfiled" />
            ) : (
              unfiled.map((transcript) => {
                const target = transcriptActionTarget(transcript)
                return (
                  <TranscriptRow
                    key={transcript.id}
                    transcript={transcript}
                    actions={(
                      <TranscriptActionsMenu
                        title={target.title}
                        onMove={() => transcriptActions.openMove(target)}
                        onDelete={() => transcriptActions.openDelete(target)}
                      />
                    )}
                  />
                )
              })
            )}
          </ProjectList>
        </section>
      )}
      <ProjectActionDialogs actions={projectActions} />
      <TranscriptActionDialogs actions={transcriptActions} />
    </div>
  )
}
