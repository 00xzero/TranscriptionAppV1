'use client'

import { useEffect, useMemo, useState } from 'react'
import { notFound, useParams, useRouter } from 'next/navigation'
import { FolderClock, Plus } from 'lucide-react'
import { ErrorFallback } from '@/components/ErrorFallback'
import { TranscriptActionsMenu } from '@/components/TranscriptActionsMenu'
import { TranscriptActionDialogs } from '@/components/TranscriptActionDialogs'
import { Button } from '@/components/ui/button'
import { AddTranscriptsDialog } from '@/components/Projects/AddTranscriptsDialog'
import { ProjectActionDialogs } from '@/components/Projects/ProjectActionDialogs'
import { ProjectActionsMenu } from '@/components/Projects/ProjectActionsMenu'
import { ProjectHeaderCard } from '@/components/Projects/ProjectHeaderCard'
import { ListSectionHeading, ProjectList, ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { ProjectRow } from '@/components/Projects/ProjectRow'
import { ProjectsEmptyState } from '@/components/Projects/ProjectsEmptyState'
import { TranscriptRow } from '@/components/Projects/TranscriptRow'
import { countLabel } from '@/components/Projects/format'
import {
  ancestorsOf,
  descendantCount,
  transcriptCountsByProject,
  transcriptsInProject,
} from '@/core/projects/tree'
import { useProjectsData, useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { useProjectActions } from '@/lib/projects/useProjectActions'
import {
  transcriptRevision,
  useProjectSpeakerSummaries,
} from '@/lib/projects/useProjectSpeakerSummaries'
import { useProjectsLoadState } from '@/lib/projects/useProjectsLoadState'
import { transcriptActionTarget } from '@/lib/transcripts/actions'
import { useTranscriptActions } from '@/lib/transcripts/useTranscriptActions'

function ProjectLoadingState({ label = 'Loading project' }: { label?: string }) {
  return (
    <div aria-label={label}>
      <div className="mb-6 h-8 w-52 animate-pulse rounded-sm bg-subtle" />
      <ProjectListSkeleton />
    </div>
  )
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()

  return <ProjectPageContent key={projectId} projectId={projectId} />
}

function ProjectPageContent({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { tree } = useProjectsData()
  const { transcripts } = useTranscriptsData()
  const { isLoading, loadError, retry } = useProjectsLoadState()
  const project = tree.byId.get(projectId)
  const currentAncestorIds = project
    ? (ancestorsOf(tree, projectId) ?? []).map((ancestor) => ancestor.id)
    : null
  const [lastKnownAncestorIds, setLastKnownAncestorIds] = useState<string[] | null>(
    currentAncestorIds
  )
  const [addOpen, setAddOpen] = useState(false)
  const projectActions = useProjectActions()
  const transcriptActions = useTranscriptActions()
  // Direct scope, to match directTranscriptCount below: a nested project's
  // speakers are reported on that project's own page.
  //
  // Gated on a resolved, active project. The hook itself must be called
  // unconditionally — the early returns below would otherwise skip it — so the
  // gate is an empty id set instead, which the hook short-circuits without a
  // request. Asking earlier would fire against a route id that may not be a uuid
  // at all, or against a project that turns out to be missing or mid-deletion,
  // and Postgres would reject the cast noisily for nothing.
  const speakerProject = !isLoading && !loadError && project && !project.deleting_at ? project : null
  const speakerIds = useMemo(
    () => (speakerProject ? [speakerProject.id] : []),
    [speakerProject]
  )
  // Only this project's own transcripts can change a direct-scope answer.
  const speakersRevision = useMemo(
    () =>
      speakerProject
        ? transcriptRevision(transcripts.filter((t) => t.project_id === speakerProject.id))
        : '',
    [transcripts, speakerProject]
  )
  const speakers = useProjectSpeakerSummaries(speakerIds, false, speakersRevision)

  if (
    currentAncestorIds &&
    (lastKnownAncestorIds === null ||
      lastKnownAncestorIds.length !== currentAncestorIds.length ||
      lastKnownAncestorIds.some((id, index) => id !== currentAncestorIds[index]))
  ) {
    setLastKnownAncestorIds(currentAncestorIds)
  }

  useEffect(() => {
    if (isLoading || loadError || project || lastKnownAncestorIds === null) return

    const destination = [...lastKnownAncestorIds]
      .reverse()
      .find((ancestorId) => tree.byId.has(ancestorId))
    router.replace(destination ? `/projects/${destination}` : '/projects')
  }, [isLoading, lastKnownAncestorIds, loadError, project, router, tree])

  if (isLoading) return <ProjectLoadingState />

  if (loadError) {
    return (
      <ErrorFallback
        title="We couldn't load this project"
        description="The project is temporarily unavailable. Try loading it again."
        primary={{ kind: 'button', label: 'Try again', onClick: retry }}
        secondary={{ kind: 'link', label: 'Back to projects', href: '/projects' }}
      />
    )
  }

  if (!project) {
    if (lastKnownAncestorIds !== null) {
      return <ProjectLoadingState label="Opening the nearest project" />
    }
    notFound()
  }

  if (project.deleting_at) {
    return (
      <>
        <div className="flex items-center justify-center px-6 py-16 text-center">
          <div className="max-w-lg">
            <FolderClock className="mx-auto h-10 w-10 text-amber-600" aria-hidden="true" />
            <h1 className="mt-4 font-serif text-4xl text-foreground">This project is being deleted</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Its contents are unavailable while deletion finishes.
            </p>
            <Button className="mt-5" variant="destructive" onClick={() => projectActions.openDelete(project)}>
              Retry Delete
            </Button>
          </div>
        </div>
        <ProjectActionDialogs actions={projectActions} />
      </>
    )
  }

  const children = tree.childrenOf.get(project.id) ?? []
  const directTranscripts = transcriptsInProject(transcripts, project.id)
  const counts = transcriptCountsByProject(transcripts)
  const isEmpty = children.length === 0 && directTranscripts.length === 0
  return (
    <div className="space-y-6">
      <ProjectHeaderCard
        project={project}
        directTranscriptCount={directTranscripts.length}
        nestedProjectCount={descendantCount(tree, project.id)}
        speakerSummary={speakers.summaries.get(project.id)}
        speakersLoading={speakers.loading}
        actions={(
          <>
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => projectActions.openCreate(project.id)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New Project
            </Button>
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Transcripts
            </Button>
          </>
        )}
        menu={(
          <ProjectActionsMenu
            project={project}
            onRename={() => projectActions.openRename(project)}
            onDelete={() => projectActions.openDelete(project)}
          />
        )}
      />

      {isEmpty && (
        <ProjectList>
          <ProjectsEmptyState variant="empty-project" />
        </ProjectList>
      )}
      {children.length > 0 && (
        <section aria-labelledby="project-subprojects-heading">
          <ListSectionHeading
            id="project-subprojects-heading"
            title="Sub-projects"
            meta={countLabel(children.length, 'project', 'projects')}
          />
          <ProjectList>
            {children.map((child) => (
              <ProjectRow
                key={child.id}
                project={child}
                directTranscriptCount={counts.get(child.id) ?? 0}
                nestedProjectCount={descendantCount(tree, child.id)}
                actions={(
                  <ProjectActionsMenu
                    project={child}
                    onRename={() => projectActions.openRename(child)}
                    onDelete={() => projectActions.openDelete(child)}
                  />
                )}
              />
            ))}
          </ProjectList>
        </section>
      )}
      {directTranscripts.length > 0 && (
        <section aria-labelledby="project-transcripts-heading">
          <ListSectionHeading
            id="project-transcripts-heading"
            title="Transcripts"
            meta={countLabel(directTranscripts.length, 'transcript', 'transcripts')}
          />
          <ProjectList>
            {directTranscripts.map((transcript) => {
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
            })}
          </ProjectList>
        </section>
      )}
      <ProjectActionDialogs actions={projectActions} />
      {addOpen && <AddTranscriptsDialog projectId={project.id} onClose={() => setAddOpen(false)} />}
      <TranscriptActionDialogs actions={transcriptActions} />
    </div>
  )
}
