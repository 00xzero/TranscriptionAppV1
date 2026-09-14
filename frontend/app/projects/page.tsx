'use client'

import { ErrorFallback } from '@/components/ErrorFallback'
import { ProjectRow } from '@/components/Projects/ProjectRow'
import { ProjectsEmptyState } from '@/components/Projects/ProjectsEmptyState'
import { TranscriptRow } from '@/components/Projects/TranscriptRow'
import {
  descendantCount,
  transcriptCountsByProject,
  transcriptsInProject,
} from '@/core/projects/tree'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'

function ProjectsLoadingState() {
  return (
    <div aria-label="Loading projects" className="divide-y divide-border rounded-sm border border-border bg-panel">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex min-h-18 animate-pulse items-center gap-4 p-4">
          <div className="h-10 w-10 rounded-sm bg-subtle" />
          <div className="space-y-2">
            <div className="h-3 w-36 rounded-sm bg-subtle" />
            <div className="h-2 w-52 rounded-sm bg-subtle" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ProjectsPage() {
  const {
    tree,
    projectsLoading,
    projectError,
    refetchProjects,
    transcripts,
    transcriptsLoading,
    transcriptError,
    refetchTranscripts,
  } = useProjectsData()

  const retry = () => {
    void Promise.all([refetchProjects(), refetchTranscripts()])
  }

  if (projectsLoading || transcriptsLoading) {
    return (
      <div className="px-6 pb-10 pt-[80px] md:px-10">
        <ProjectsLoadingState />
      </div>
    )
  }

  if (projectError || transcriptError) {
    return (
      <ErrorFallback
        title="We couldn't load your projects"
        description="The project list is temporarily unavailable. Try loading it again."
        primary={{ kind: 'button', label: 'Try again', onClick: retry }}
        secondary={{ kind: 'link', label: 'Go home', href: '/' }}
      />
    )
  }

  const unfiled = transcriptsInProject(transcripts, null)
  if (tree.roots.length === 0 && unfiled.length === 0) {
    return (
      <div className="px-6 pb-10 pt-[80px] md:px-10">
        <h1 className="sr-only">Projects</h1>
        <div className="rounded-sm border border-border bg-panel">
          <ProjectsEmptyState variant="no-projects" />
        </div>
      </div>
    )
  }

  const counts = transcriptCountsByProject(transcripts)

  return (
    <div className="space-y-8 px-6 pb-10 pt-[80px] md:px-10">
      {tree.roots.length > 0 ? (
        <section aria-labelledby="projects-heading">
          <div className="mb-3 border-b border-border pb-2">
            <h1 id="projects-heading" className="font-serif text-2xl text-foreground">
              Projects
            </h1>
          </div>
          <div className="divide-y divide-border rounded-sm border border-border bg-panel">
            {tree.roots.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                directTranscriptCount={counts.get(project.id) ?? 0}
                nestedProjectCount={descendantCount(tree, project.id)}
              />
            ))}
          </div>
        </section>
      ) : (
        <h1 className="sr-only">Projects</h1>
      )}

      <section aria-labelledby="unfiled-heading">
        <div className="mb-3 flex items-baseline justify-between border-b border-border pb-2">
          <h2 id="unfiled-heading" className="font-serif text-2xl text-foreground">
            Unfiled
          </h2>
          <span className="font-mono text-xs text-muted">
            {unfiled.length} {unfiled.length === 1 ? 'transcript' : 'transcripts'}
          </span>
        </div>
        <div className="divide-y divide-border rounded-sm border border-border bg-panel">
          {unfiled.length === 0 ? (
            <ProjectsEmptyState variant="empty-unfiled" />
          ) : (
            unfiled.map((transcript) => (
              <TranscriptRow key={transcript.id} transcript={transcript} />
            ))
          )}
        </div>
      </section>
    </div>
  )
}
