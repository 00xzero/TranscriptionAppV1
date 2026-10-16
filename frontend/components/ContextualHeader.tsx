"use client"

import { usePathname } from 'next/navigation'
import { Redo2, Undo2 } from 'lucide-react'
import { useModal } from '@/lib/ModalContext'
import { useAuth } from '@/lib/auth/AuthProvider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import RecordingPill from '@/components/RecordingSession/RecordingPill'
import { EditorHeaderTitle } from '@/components/Projects/EditorHeaderTitle'
import { ProjectsHeaderTitle } from '@/components/Projects/ProjectsHeaderTitle'
import { PeopleHeaderTitle } from '@/components/People/PeopleHeaderTitle'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { projectIdFromPathname } from '@/lib/projects/routes'
import { useUndoControls } from '@/lib/editor/undoControls'
import { useApplePlatform } from '@/lib/editor/undoShortcut'
import { UndoList } from '@/components/UndoList'
import { cn } from '@/lib/utils'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'

// The editor's square header buttons: undo, redo and export.
const HEADER_ICON_DISABLED = 'disabled:opacity-30 disabled:cursor-default disabled:hover:border-subtle-border'
const HEADER_ICON_BUTTON = 'group flex h-[30px] w-[30px] items-center justify-center rounded-md border border-subtle-border bg-field/10 backdrop-blur-xs transition-all hover:border-trust-blue/30 hover:bg-field active:scale-95 dark:bg-subtle dark:hover:bg-surface'

export default function ContextualHeader() {
  const undoControls = useUndoControls()
  const apple = useApplePlatform()
  const { openCaptureModal } = useModal()
  const { userId, ready } = useAuth()
  const pathname = usePathname()
  const { tree, projectsLoading } = useProjectsData()
  const isAuthRoute = pathname?.startsWith('/auth') ?? false
  const isProjectsRoute = pathname === '/projects' || pathname?.startsWith('/projects/')
  const isPeopleRoute = pathname === '/people' || pathname?.startsWith('/people/')
  const isTranscriptsRoute = pathname === '/transcripts'
  const routeProjectId = projectIdFromPathname(pathname)
  const routeProject = routeProjectId ? tree.byId.get(routeProjectId) : null
  const hideCapture = Boolean(
    routeProjectId && (projectsLoading || !routeProject || routeProject.deleting_at)
  )

  const isEditorRoute = pathname?.startsWith('/editor/')

  // Auth routes always render the unauthenticated chrome, regardless of identity.
  const isAuthenticated = !isAuthRoute && Boolean(userId)
  const isLoading = !isAuthRoute && !ready && !userId

  return (
    <header className={`relative h-[var(--header-height)] flex items-center justify-between gap-4 px-6 transition-colors duration-300 ${isEditorRoute ? 'pointer-events-none [&>div]:relative [&>div]:z-(--z-header) [&_button]:pointer-events-auto [&_a]:pointer-events-auto' : 'z-(--z-header) pointer-events-auto border-b border-border bg-paper/45 dark:bg-night-surface/45 backdrop-blur-md'}`}>
      {/* The backdrop blocks clicks to covered transcript cards and stays above
          the pinned waveform but below the mini track; header controls remain
          above its larger hit area. The layer order lives in globals.css. */}
      {isEditorRoute && <span aria-hidden="true" className="pointer-events-auto absolute inset-0 z-(--z-header-backdrop) border-b border-border bg-paper/45 dark:bg-night-surface/45 backdrop-blur-md" />}
      {/* Left: Logo (when unauthenticated) or View Title / Breadcrumbs (when authenticated) */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {isLoading ? (
          <div className="h-6 w-28" aria-hidden="true" />
        ) : !isAuthenticated ? (
          // Olivetti Logo - shown when not authenticated
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="h-6 w-1 bg-ink dark:bg-paper rounded-full" />
              <div className="h-2 w-2 bg-ember-red rounded-xs" />
            </div>
            <span className="font-serif text-2xl italic text-ink dark:text-paper tracking-tight">
              olivetti
            </span>
          </div>
        ) : isProjectsRoute ? (
          <ProjectsHeaderTitle pathname={pathname} />
        ) : isPeopleRoute ? (
          <PeopleHeaderTitle pathname={pathname} />
        ) : isEditorRoute ? (
          <EditorHeaderTitle pathname={pathname} />
        ) : isTranscriptsRoute ? (
          // Transcripts lives under the Library, so it reads as a step down from it.
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 font-serif text-xl italic">
            <Link
              href="/"
              className="rounded-sm text-muted hover:text-trust-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60"
            >
              Library
            </Link>
            <span aria-hidden="true" className="not-italic text-muted">/</span>
            <span aria-current="page" className="truncate text-ink dark:text-paper">Transcripts</span>
          </nav>
        ) : (
          <span className="font-serif text-xl italic text-ink dark:text-paper">
            Library
          </span>
        )}
      </div>

      {/* Right: Editor actions (Find/Replace + Export) */}
      {isAuthenticated && isEditorRoute && (
        <div className="flex shrink-0 items-center gap-2">
          <RecordingPill />
          {/* Shown while an edit waits for the connection; undo and redo pause meanwhile. */}
          {undoControls?.reconnecting && (
            <span role="status" className="rounded-full border border-subtle-border bg-subtle px-2.5 py-0.5 font-sans text-[10px] leading-[16px] text-muted whitespace-nowrap">
              Reconnecting…
            </span>
          )}
          {/* Undo and redo, Word-style: the tooltip names the step; undo's list undoes several at once. */}
          {(['undo', 'redo'] as const).map((action) => {
            const enabled = action === 'undo' ? undoControls?.canUndo : undoControls?.canRedo
            const label = action === 'undo' ? undoControls?.undoLabel : undoControls?.redoLabel
            const shortcut = apple ? (action === 'undo' ? '⌘Z' : '⇧⌘Z') : (action === 'undo' ? 'Ctrl+Z' : 'Ctrl+Y')
            const name = `${action === 'undo' ? 'Undo' : 'Redo'}${label ? ` ${label}` : ''}`
            const Icon = action === 'undo' ? Undo2 : Redo2
            const button = (
              <Tooltip key={action}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(HEADER_ICON_BUTTON, HEADER_ICON_DISABLED, action === 'undo' && 'rounded-r-none')}
                    disabled={!enabled}
                    aria-label={name}
                    aria-keyshortcuts={action === 'undo' ? 'Control+Z Meta+Z' : 'Control+Y Meta+Shift+Z'}
                    onClick={() => undoControls?.[action]()}
                  >
                    <Icon className="h-3.5 w-3.5 opacity-60 group-hover:opacity-90 transition-opacity" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{`${name} (${shortcut})`}</TooltipContent>
              </Tooltip>
            )
            if (action === 'redo') return button
            return (
              <div key={action} className="flex">
                {button}
                <UndoList
                  disabled={!enabled}
                  version={undoControls?.version ?? 0}
                  names={() => undoControls?.undoNames() ?? []}
                  undoMany={(count) => undoControls?.undoMany(count)}
                  className={cn(HEADER_ICON_BUTTON, HEADER_ICON_DISABLED, 'w-4 rounded-l-none border-l-0')}
                />
              </div>
            )
          })}
          {/* Export icon button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={HEADER_ICON_BUTTON}
                onClick={() => window.dispatchEvent(new CustomEvent('open-export'))}
                aria-label="Export"
              >
                <svg
                  className="w-3.5 h-3.5 opacity-50 group-hover:opacity-80 transition-all"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent>Export</TooltipContent>
          </Tooltip>

          {/* Find & Replace button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="group box-border flex h-[30px] w-[172px] items-center justify-between rounded-md border border-subtle-border bg-field/10 px-[13px] shadow-xs backdrop-blur-xs transition-all hover:border-trust-blue/30 hover:bg-field active:scale-95 dark:bg-subtle dark:hover:bg-surface"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('open-find-replace'))
                }
                aria-label="Open find and replace"
              >
                <div className="flex items-center gap-[8px]">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="opacity-50 group-hover:opacity-80 transition-opacity"
                  >
                    <circle
                      cx="5.5"
                      cy="5.5"
                      r="4.5"
                      className="stroke-ink dark:stroke-paper"
                      strokeWidth="1.2"
                    />
                    <path
                      d="M9 9L12.5 12.5"
                      className="stroke-ink dark:stroke-paper"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="font-sans text-[10px] leading-[16px] text-ink/50 dark:text-paper/50 group-hover:text-ink/80 dark:group-hover:text-paper/80 whitespace-nowrap transition-colors">
                    Find & Replace
                  </span>
                </div>
                <div className="flex h-[15px] items-center justify-center rounded px-[6px] bg-subtle">
                  <span className="font-sans text-[8.5px] text-ink/50 dark:text-paper/50 leading-[15px]">
                    {'\u2318'}F
                  </span>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent>Find and replace text</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Right: Search + Capture Button - Only show when authenticated and on library route */}
      {isAuthenticated && !isEditorRoute && (
        <div className="flex shrink-0 items-center gap-6">
          <RecordingPill />
          {/* Global Search - Desktop Only */}
          <div className="group relative hidden items-center gap-3 rounded-lg border border-border bg-field/50 px-3 py-1.5 transition-all focus-within:border-trust-blue/50 focus-within:bg-field md:flex dark:bg-subtle dark:focus-within:bg-surface">
            <span className="font-mono text-[10px] text-ink/40 dark:text-paper/40 group-focus-within:text-trust-blue transition-colors">
              ?
            </span>
            <input
              type="text"
              placeholder="Recall a decision..."
              aria-label="Recall a decision..."
              className="bg-transparent border-none w-56 text-sm font-serif italic focus:outline-hidden focus:ring-0 placeholder:text-ink/30 dark:placeholder:text-paper/20 text-ink dark:text-paper"
            />
          </div>

          {/* Capture Button */}
          {!hideCapture && <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                onClick={() => openCaptureModal(routeProjectId ? { projectId: routeProjectId } : undefined)}
                aria-label="Open capture modal"
                className="gap-2 hover:shadow-md"
              >
                <div className="h-2 w-2 animate-pulse rounded-full bg-solid-foreground" />
                <span className="hidden md:inline">Capture</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Start new recording</TooltipContent>
          </Tooltip>}
        </div>
      )}
    </header>
  )
}
