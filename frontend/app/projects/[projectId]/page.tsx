'use client'

import { useEffect, useState } from 'react'
import { notFound, useParams, useRouter } from 'next/navigation'
import { FolderClock } from 'lucide-react'
import { ErrorFallback } from '@/components/ErrorFallback'
import { ProjectList, ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { ProjectRow } from '@/components/Projects/ProjectRow'
import { ProjectsEmptyState } from '@/components/Projects/ProjectsEmptyState'
import { TranscriptRow } from '@/components/Projects/TranscriptRow'
import {
  ancestorsOf,
  descendantCount,
  transcriptCountsByProject,
  transcriptsInProject,
} from '@/core/projects/tree'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { useProjectsLoadState } from '@/lib/projects/useProjectsLoadState'

function ProjectLoadingState({ label = 'Loading project' }: { label?: string }) {
  return (
    <div className="px-6 pb-10 pt-[80px] md:px-10" aria-label={label}>
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
  const { tree, transcripts } = useProjectsData()
  const { isLoading, loadError, retry } = useProjectsLoadState()
  const project = tree.byId.get(projectId)
  const currentAncestorIds = project
    ? (ancestorsOf(tree, projectId) ?? []).map((ancestor) => ancestor.id)
    : null
  const [lastKnownAncestorIds, setLastKnownAncestorIds] = useState<string[] | null>(
    currentAncestorIds
  )

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
      <div className="flex min-h-full items-center justify-center px-6 pb-16 pt-[var(--header-height)] text-center">
        <div className="max-w-lg">
          <FolderClock className="mx-auto h-10 w-10 text-amber-600" aria-hidden="true" />
          <h1 className="mt-4 font-serif text-4xl text-foreground">This project is being deleted</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Its contents are unavailable while deletion finishes.
          </p>
        </div>
      </div>
    )
  }

  const children = tree.childrenOf.get(project.id) ?? []
  const directTranscripts = transcriptsInProject(transcripts, project.id)
  const counts = transcriptCountsByProject(transcripts)

  return (
    <div className="px-6 pb-10 pt-[80px] md:px-10">
      <div className="mb-6 border-b border-border pb-3">
        <h1 className="font-serif text-3xl text-foreground">{project.name}</h1>
      </div>

      <ProjectList>
        {children.length === 0 && directTranscripts.length === 0 && (
          <ProjectsEmptyState variant="empty-project" />
        )}
        {children.map((child) => (
          <ProjectRow
            key={child.id}
            project={child}
            directTranscriptCount={counts.get(child.id) ?? 0}
            nestedProjectCount={descendantCount(tree, child.id)}
          />
        ))}
        {directTranscripts.map((transcript) => (
          <TranscriptRow key={transcript.id} transcript={transcript} />
        ))}
      </ProjectList>
    </div>
  )
}
