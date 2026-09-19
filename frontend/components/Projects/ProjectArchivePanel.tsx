'use client'

import { useMemo, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Inbox, Library } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { transcriptCountsByProject, transcriptsInProject } from '@/core/projects/tree'
import { useProjectsData, useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { projectIdFromPathname } from '@/lib/projects/routes'
import { useProjectsLoadState } from '@/lib/projects/useProjectsLoadState'
import { useProjectTreeView } from '@/lib/projects/useProjectTreeView'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'

const INDENT_PX = 16

function rowClassName(isActive: boolean) {
  return `flex items-center gap-1 rounded-sm pr-2 text-sm transition-colors ${
    isActive
      ? 'bg-warm-highlight text-trust-blue dark:bg-night-border dark:text-paper'
      : 'text-foreground/75 hover:bg-subtle hover:text-foreground'
  }`
}

const linkClassName =
  'flex min-w-0 flex-1 items-center gap-2.5 rounded-sm py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60'

function Count({ value }: { value: number }) {
  return <span className="ml-auto shrink-0 pl-2 font-mono text-xs text-muted">{value}</span>
}

function PinnedRow({ href, icon, label, count }: { href: string; icon: ReactNode; label: string; count: number }) {
  return (
    <li className={rowClassName(false)}>
      <span className="w-6 shrink-0" />
      <Link href={href} className={linkClassName}>
        {icon}
        <span className="truncate">{label}</span>
        <Count value={count} />
      </Link>
    </li>
  )
}

/** Persistent folder navigator shown beside every `/projects` route on wide screens. */
export function ProjectArchivePanel() {
  const pathname = usePathname()
  const { tree } = useProjectsData()
  const { transcripts } = useTranscriptsData()
  const { isLoading, loadError } = useProjectsLoadState()
  const activeId = projectIdFromPathname(pathname) ?? null
  const view = useProjectTreeView(tree, activeId, { expandRevealed: true })
  const counts = useMemo(() => transcriptCountsByProject(transcripts), [transcripts])
  const unfiledCount = useMemo(() => transcriptsInProject(transcripts, null).length, [transcripts])

  // The page renders the retryable error; an empty navigator beside it adds nothing.
  if (loadError) return null

  return (
    <aside className="sticky top-[80px] hidden w-72 shrink-0 lg:block">
      <nav
        aria-label="Project archive"
        className="flex max-h-[calc(100vh-80px-2.5rem)] flex-col rounded-sm border border-border bg-panel"
      >
        <div className="space-y-3 border-b border-border p-4">
          <h2 className="font-mono text-xs uppercase tracking-wide text-muted">Project Archive</h2>
          <Input
            aria-label="Search project archive"
            placeholder="Search projects…"
            value={view.query}
            onChange={(event) => view.setQuery(event.target.value)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div aria-label="Loading project archive" className="space-y-2 p-2">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="h-5 animate-pulse rounded-sm bg-subtle" />
              ))}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {!view.isSearching && (
                <>
                  <PinnedRow
                    href="/transcripts"
                    icon={<Library className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    label="All Transcripts"
                    count={transcripts.length}
                  />
                  <PinnedRow
                    href="/projects#unfiled"
                    icon={<Inbox className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    label="Unfiled"
                    count={unfiledCount}
                  />
                  {view.nodes.length > 0 && <li aria-hidden="true" className="my-2 border-t border-border" />}
                </>
              )}
              {view.nodes.map(({ project, depth }) => {
                const hasChildren = view.visibleChildren(project.id).length > 0
                const isExpanded = view.isExpanded(project.id)
                const isActive = project.id === activeId
                const FolderIcon = isActive ? FolderOpen : Folder

                return (
                  <li
                    key={project.id}
                    className={rowClassName(isActive)}
                    style={{ paddingLeft: `${depth * INDENT_PX}px` }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${project.name}`}
                        aria-expanded={isExpanded}
                        disabled={view.isSearching}
                        onClick={() => view.setNodeExpanded(project.id, 'toggle')}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60 disabled:opacity-50"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      <span className="w-6 shrink-0" />
                    )}
                    <Link
                      href={`/projects/${project.id}`}
                      aria-current={isActive ? 'page' : undefined}
                      className={linkClassName}
                    >
                      <FolderIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{project.name}</span>
                      <Count value={counts.get(project.id) ?? 0} />
                    </Link>
                  </li>
                )
              })}
              {view.isSearching && view.nodes.length === 0 && (
                <li className="px-3 py-4 text-center text-sm text-muted">No matching projects.</li>
              )}
              {!view.isSearching && view.visibleRoots.length === 0 && (
                <li className="px-3 py-4 text-center text-sm text-muted">No projects yet.</li>
              )}
            </ul>
          )}
        </div>
      </nav>
    </aside>
  )
}
