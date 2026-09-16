'use client'

import { useState } from 'react'
import { ErrorFallback } from '@/components/ErrorFallback'
import { TranscriptActionsMenu } from '@/components/TranscriptActionsMenu'
import { TranscriptActionDialogs } from '@/components/TranscriptActionDialogs'
import { Button } from '@/components/ui/button'
import { DeleteProjectDialog } from '@/components/Projects/DeleteProjectDialog'
import { ProjectActionsMenu } from '@/components/Projects/ProjectActionsMenu'
import { ProjectNameDialog } from '@/components/Projects/ProjectNameDialog'
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
import type { Project } from '@/contracts/db'
import { transcriptActionTarget } from '@/lib/transcripts/actions'
import { useTranscriptActions } from '@/lib/transcripts/useTranscriptActions'

export default function ProjectsPage() {
  const { tree, transcripts, createProject, renameProject } = useProjectsData()
  const { isLoading, loadError, retry } = useProjectsLoadState()
  const [createOpen, setCreateOpen] = useState(false)
  const [renameProjectTarget, setRenameProjectTarget] = useState<Project | null>(null)
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<Project | null>(null)
  const transcriptActions = useTranscriptActions()

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
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
          <h1 id="projects-heading" className="font-serif text-2xl text-foreground">Projects</h1>
          <Button size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>New Project</Button>
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
                    onRename={() => setRenameProjectTarget(project)}
                    onDelete={() => setDeleteProjectTarget(project)}
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
      <ProjectNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        parentId={null}
        onSubmit={(name) => createProject({ name, parent_id: null })}
      />
      {renameProjectTarget && <ProjectNameDialog
        open
        onOpenChange={(open) => !open && setRenameProjectTarget(null)}
        mode="rename"
        parentId={renameProjectTarget.parent_id}
        projectId={renameProjectTarget.id}
        initialName={renameProjectTarget.name}
        onSubmit={(name) => renameProject(renameProjectTarget.id, name)}
      />}
      {deleteProjectTarget && (
        <DeleteProjectDialog project={deleteProjectTarget} onClose={() => setDeleteProjectTarget(null)} />
      )}
      <TranscriptActionDialogs actions={transcriptActions} />
    </div>
  )
}
