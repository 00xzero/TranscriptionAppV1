'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Inbox,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { transcriptCountsByProject, transcriptsInProject } from '@/core/projects/tree'
import { PROJECT_ARCHIVE_COLLAPSED_KEY } from '@/lib/constants'
import { useProjectsData, useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { projectIdFromPathname } from '@/lib/projects/routes'
import { useProjectsLoadState } from '@/lib/projects/useProjectsLoadState'
import { useProjectTreeView } from '@/lib/projects/useProjectTreeView'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { cn } from '@/lib/utils'

const INDENT_PX = 16
const subscribeToHydration = () => () => {}
const getClientHydrationSnapshot = () => true
const getServerHydrationSnapshot = () => false

function rowClassName(isActive: boolean) {
  return `flex items-center rounded-sm pr-2 text-sm transition-colors ${
    isActive
      ? 'bg-warm-highlight text-trust-blue dark:bg-night-border dark:text-paper'
      : 'text-foreground/75 hover:bg-subtle hover:text-foreground'
  }`
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60'

const linkClassName = `flex min-w-0 flex-1 items-center gap-1 rounded-sm py-2 ${focusRing}`

// Every icon lives in this fixed-width leading slot in both states, so the
// collapsed rail is just the expanded panel clipped to its icon column and
// nothing shifts when it toggles (the same approach as the app Sidebar).
const ICON_SLOT = 'flex w-8 shrink-0 items-center justify-center'

const iconButtonClassName = `flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-subtle hover:text-foreground ${focusRing}`

function Count({ value }: { value: number }) {
  return <span className="ml-auto shrink-0 pl-2 font-mono text-xs text-muted">{value}</span>
}

function RailBadge({ value }: { value: number }) {
  if (value === 0) return null
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1.5 right-0 rounded-sm bg-panel px-0.5 font-mono text-[10px] leading-none text-muted"
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}

function PinnedRow({
  href,
  icon,
  label,
  count,
  isCollapsed,
}: {
  href: string
  icon: ReactNode
  label: string
  /** Null while loading, so a placeholder zero never flashes. */
  count: number | null
  isCollapsed: boolean
}) {
  return (
    <li className={cn(rowClassName(false), isCollapsed && 'pr-0')}>
      <Tooltip disabled={!isCollapsed}>
        <TooltipTrigger asChild>
          <Link
            href={href}
            aria-label={isCollapsed ? (count === null ? label : `${label}, ${count}`) : undefined}
            className={cn(linkClassName, 'h-9 py-0')}
          >
            <span className={`relative ${ICON_SLOT}`}>
              {icon}
              {isCollapsed && count !== null && <RailBadge value={count} />}
            </span>
            {!isCollapsed && (
              <>
                <span className="truncate">{label}</span>
                {count !== null && <Count value={count} />}
              </>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{count === null ? label : `${label} · ${count}`}</TooltipContent>
      </Tooltip>
    </li>
  )
}

/** Persistent folder navigator shown beside every `/projects` route on wide screens. */
export function ProjectArchivePanel() {
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(PROJECT_ARCHIVE_COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot
  )
  const [motionReady, setMotionReady] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const focusSearchOnExpand = useRef(false)
  const { tree } = useProjectsData()
  const { transcripts } = useTranscriptsData()
  const { isLoading, loadError } = useProjectsLoadState()
  const activeId = projectIdFromPathname(pathname) ?? null
  const view = useProjectTreeView(tree, activeId, { expandRevealed: true })
  const counts = useMemo(() => transcriptCountsByProject(transcripts), [transcripts])
  const unfiledCount = useMemo(() => transcriptsInProject(transcripts, null).length, [transcripts])

  useEffect(() => {
    if (!mounted) return
    const raf = requestAnimationFrame(() => setMotionReady(true))
    return () => cancelAnimationFrame(raf)
  }, [mounted])

  // The rail's search icon expands the panel; the input only exists once expanded.
  useEffect(() => {
    if (isCollapsed || !focusSearchOnExpand.current) return
    focusSearchOnExpand.current = false
    searchInputRef.current?.focus()
  }, [isCollapsed])

  const setCollapsed = useCallback((next: boolean) => {
    setIsCollapsed(next)
    try { localStorage.setItem(PROJECT_ARCHIVE_COLLAPSED_KEY, String(next)) } catch { }
  }, [])

  const expandToSearch = useCallback(() => {
    focusSearchOnExpand.current = true
    setCollapsed(false)
  }, [setCollapsed])

  // The page renders the retryable error; an empty navigator beside it adds nothing.
  if (loadError) return null

  // Match the persisted width before hydration so a collapsed archive never
  // flashes open. The root layout seeds these CSS values before first paint;
  // the shell reuses the real panel's row geometry so nothing jumps on hydrate.
  if (!mounted) {
    const expandedOnly = { display: 'var(--project-archive-initial-expanded-display, block)' }
    const expandedOnlyFlex = { display: 'var(--project-archive-initial-expanded-flex, flex)' }
    const collapsedOnlyFlex = { display: 'var(--project-archive-initial-collapsed-flex, none)' }
    return (
      <aside
        aria-hidden="true"
        className="sticky top-[80px] mr-[var(--project-archive-initial-margin,0rem)] hidden w-[var(--project-archive-initial-width,18rem)] shrink-0 overflow-hidden lg:block"
      >
        <div className="w-72 rounded-sm border border-border bg-panel text-muted">
          <div className="space-y-1 border-b border-border p-2">
            <div className="h-8 items-center" style={expandedOnlyFlex}>
              <span className="ml-2 whitespace-nowrap font-mono text-xs uppercase tracking-wide">
                Project Archive
              </span>
              <span className={`ml-auto h-8 ${ICON_SLOT}`}>
                <PanelLeftClose className="h-4 w-4" />
              </span>
            </div>
            <div className="h-8 items-center" style={collapsedOnlyFlex}>
              <span className={`h-8 ${ICON_SLOT}`}>
                <PanelLeftOpen className="h-4 w-4" />
              </span>
            </div>
            <div className="relative h-9">
              <div className="h-9 rounded-sm border border-border bg-field/50" style={expandedOnly} />
              <span className={`absolute left-0 top-0 h-9 ${ICON_SLOT}`}>
                <Search className="h-4 w-4" />
              </span>
            </div>
          </div>
          <div className="space-y-0.5 p-2">
            {[Library, Inbox].map((Icon, index) => (
              <div key={index} className="flex h-9 items-center">
                <span className={ICON_SLOT}>
                  <Icon className="h-4 w-4" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    )
  }

  const widthTransitionClass = motionReady
    ? 'transition-[width,margin] duration-100 ease-in-out motion-reduce:transition-none'
    : ''
  const showPinned = isCollapsed || !view.isSearching

  return (
    <aside
      data-state={isCollapsed ? 'collapsed' : 'expanded'}
      className={`sticky top-[80px] hidden shrink-0 overflow-hidden lg:block ${widthTransitionClass} ${
        isCollapsed ? '-mr-2 w-[3.125rem]' : 'w-72'
      }`}
    >
      <nav
        aria-label="Project archive"
        className={`flex max-h-[calc(100vh-80px-2.5rem)] flex-col rounded-sm border border-border bg-panel ${
          isCollapsed ? 'w-[3.125rem]' : 'w-72'
        }`}
      >
        <div className="space-y-1 border-b border-border p-2">
          <div className="flex h-8 items-center">
            {!isCollapsed && (
              <h2 className="ml-2 whitespace-nowrap font-mono text-xs uppercase tracking-wide text-muted">
                Project Archive
              </h2>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={isCollapsed ? 'Expand project archive' : 'Collapse project archive'}
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed(!isCollapsed)}
                  className={cn(iconButtonClassName, !isCollapsed && 'ml-auto')}
                >
                  {isCollapsed ? (
                    <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side={isCollapsed ? 'right' : 'top'}>
                {isCollapsed ? 'Expand project archive' : 'Collapse project archive'}
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="relative h-9">
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Search projects"
                    onClick={expandToSearch}
                    className={cn(iconButtonClassName, 'h-9')}
                  >
                    <Search className="h-4 w-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Search projects</TooltipContent>
              </Tooltip>
            ) : (
              <>
                <Input
                  ref={searchInputRef}
                  aria-label="Search project archive"
                  placeholder="Search projects…"
                  value={view.query}
                  onChange={(event) => view.setQuery(event.target.value)}
                  className="h-9 py-0 pl-8"
                />
                <span className={`pointer-events-none absolute left-0 top-0 h-9 text-muted ${ICON_SLOT}`}>
                  <Search className="h-4 w-4" aria-hidden="true" />
                </span>
              </>
            )}
          </div>
        </div>

        <div className={`min-h-0 flex-1 p-2 ${isCollapsed ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <ul className="space-y-0.5">
            {showPinned && (
              <>
                <PinnedRow
                  href="/transcripts"
                  icon={<Library className="h-4 w-4" aria-hidden="true" />}
                  label="All Transcripts"
                  count={isLoading ? null : transcripts.length}
                  isCollapsed={isCollapsed}
                />
                <PinnedRow
                  href="/projects#unfiled"
                  icon={<Inbox className="h-4 w-4" aria-hidden="true" />}
                  label="Unfiled"
                  count={isLoading ? null : unfiledCount}
                  isCollapsed={isCollapsed}
                />
              </>
            )}
            {!isCollapsed &&
              (isLoading ? (
                <li aria-label="Loading project archive" className="space-y-2 p-2">
                  {[0, 1, 2, 3].map((row) => (
                    <div key={row} className="h-5 animate-pulse rounded-sm bg-subtle" />
                  ))}
                </li>
              ) : (
                <>
                  {showPinned && view.nodes.length > 0 && (
                    <li aria-hidden="true" className="my-2 border-t border-border" />
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
                            className={`h-6 rounded-sm text-muted hover:text-foreground disabled:opacity-50 ${ICON_SLOT} ${focusRing}`}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          <span className={ICON_SLOT} />
                        )}
                        <Link
                          href={`/projects/${project.id}`}
                          aria-current={isActive ? 'page' : undefined}
                          className={`${linkClassName} gap-2.5`}
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
                </>
              ))}
          </ul>
        </div>
      </nav>
    </aside>
  )
}
