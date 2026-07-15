"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Library, PenLine, Users, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useGuardedNavigate } from '@/lib/recording/guardedNavigation'
import { hasUnresolvedRecordingArtifact } from '@/lib/recording/session'
import { createClient } from '@/infra/supabase/client'
import { toast } from '@/components/ui/toaster'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import AccountMenu from '@/components/AccountMenu'
import { SIDEBAR_COLLAPSED_KEY } from '@/lib/constants'
import {
  DARK_MODE_MEDIA_QUERY,
  applyThemePreference,
  detectInitialTheme,
  resolveAppTheme,
  supportsSystemThemePreference,
  systemPrefersDark,
} from '@/lib/theme'
import type { User } from '@supabase/supabase-js'
import type { AppTheme } from '@/types/theme'

interface SidebarProps {
  className?: string
}

export default function Sidebar({ className = '' }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const isAuthRoute = pathname?.startsWith('/auth') ?? false
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [theme, setTheme] = useState<AppTheme>('light')
  const [supportsSystemTheme, setSupportsSystemTheme] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [mounted, setMounted] = useState(false)
  // Gates transition classes so the first real-DOM paint (at the persisted
  // width) never animates in from the SSR placeholder width. Flipped a frame
  // after `mounted` so the correct width paints once before motion is armed.
  const [motionReady, setMotionReady] = useState(false)

  // Initialize state from localStorage after mount
  useEffect(() => {
    setMounted(true)
    // Load collapsed state
    try {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      if (saved === 'true') setIsCollapsed(true)
    } catch { }
    // Load theme
    const canUseSystemTheme = supportsSystemThemePreference()
    setSupportsSystemTheme(canUseSystemTheme)
    const initialTheme = detectInitialTheme(canUseSystemTheme)
    setTheme(initialTheme)
    applyThemePreference(initialTheme)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const raf = requestAnimationFrame(() => setMotionReady(true))
    return () => cancelAnimationFrame(raf)
  }, [mounted])

  // Fetch user
  useEffect(() => {
    if (isAuthRoute) {
      setUser(null)
      return
    }

    const supabase = createClient()
    let isMounted = true

    const getUser = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser()
        if (error) {
          console.error('Failed to fetch authenticated user in Sidebar:', error)
          return
        }

        if (isMounted) {
          setUser(user)
        }
      } catch (error) {
        console.error('Unexpected error fetching authenticated user in Sidebar:', error)
      }
    }

    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUser(session?.user ?? null)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [isAuthRoute])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const newValue = !prev
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newValue)) } catch { }
      return newValue
    })
  }, [])

  const setThemePreference = useCallback((next: AppTheme) => {
    const preference = next === 'system' && !supportsSystemTheme
      ? resolveAppTheme('system', systemPrefersDark())
      : next
    setTheme(preference)
    applyThemePreference(preference)
  }, [supportsSystemTheme])

  // Keep 'system' live: when the OS appearance flips while the app is open and
  // the user is following the system, re-apply. Pinned light/dark ignore this.
  useEffect(() => {
    if (!mounted || theme !== 'system' || !supportsSystemTheme) return
    const mql = window.matchMedia(DARK_MODE_MEDIA_QUERY)
    const handler = () => applyThemePreference('system')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [theme, mounted, supportsSystemTheme])

  const guardedNav = useGuardedNavigate()

  const handleSignOut = async () => {
    // Auth-boundary guard (Phase 3): a recording artifact must be resolved before
    // leaving the user/context it belongs to. Block sign-out and tell the user to
    // finish or discard first — never silently discard their audio.
    if (hasUnresolvedRecordingArtifact()) {
      toast({
        title: 'Finish your recording first',
        description:
          'Save & transcribe or discard your in-progress recording before signing out.',
      })
      return
    }
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  const navigateTo = (path: string) => {
    guardedNav.push(path)
  }

  // Don't show sidebar on auth pages
  if (isAuthRoute) {
    return null
  }

  // SSR placeholder
  if (!mounted) {
    return (
      <nav
        aria-hidden="true"
        className={`sidebar-initial-shell flex shrink-0 flex-col justify-between overflow-hidden border-r border-[#D1CEC5] bg-[#DFDCD4] dark:border-night-border dark:bg-night-surface ${className}`}
      >
        <div>
          <div className="sidebar-initial-inline-padding flex h-[56px] items-center justify-between gap-2 overflow-hidden">
            <div className="flex min-w-0 items-center">
              <span className="flex w-10 shrink-0 items-center justify-center">
                <span className="flex items-center gap-1.5">
                  <span className="h-6 w-1 rounded-full bg-ink dark:bg-paper" />
                  <span className="h-2 w-2 rounded-xs bg-ember-red" />
                </span>
              </span>
              <span
                className="hidden whitespace-nowrap font-serif text-2xl italic tracking-tight text-ink md:block dark:text-paper"
                style={{ opacity: 'var(--sidebar-initial-label-opacity, 1)' }}
              >
                olivetti
              </span>
            </div>
            <PanelLeftClose
              className="hidden h-[18px] w-[18px] shrink-0 text-ink/40 md:block dark:text-paper/40"
              style={{ opacity: 'var(--sidebar-initial-label-opacity, 1)' }}
              strokeWidth={1.75}
            />
          </div>

          <div className="sidebar-initial-inline-padding space-y-1 pt-3 pb-6">
            <div className="flex items-center overflow-hidden whitespace-nowrap rounded-md border border-[#D1CEC5] bg-white/50 py-2.5 text-ink shadow-xs dark:border-night-border dark:bg-white/5 dark:text-paper">
              <span className="flex w-10 shrink-0 items-center justify-center">
                <Library className="h-[18px] w-[18px] opacity-60" strokeWidth={1.75} />
              </span>
              <span
                className="hidden pr-3 text-sm font-medium md:block"
                style={{ opacity: 'var(--sidebar-initial-label-opacity, 1)' }}
              >
                Library
              </span>
            </div>
            <div className="flex items-center overflow-hidden whitespace-nowrap rounded-md py-2.5 text-ink/70 dark:text-paper/70">
              <span className="flex w-10 shrink-0 items-center justify-center">
                <PenLine className="h-[18px] w-[18px] opacity-60" strokeWidth={1.75} />
              </span>
              <span
                className="hidden pr-3 text-sm font-medium md:block"
                style={{ opacity: 'var(--sidebar-initial-label-opacity, 1)' }}
              >
                Drafts <span className="ml-1 font-mono text-[10px] font-normal opacity-50">(coming soon)</span>
              </span>
            </div>
            <div className="flex items-center overflow-hidden whitespace-nowrap rounded-md py-2.5 text-ink/70 dark:text-paper/70">
              <span className="flex w-10 shrink-0 items-center justify-center">
                <Users className="h-[18px] w-[18px] opacity-60" strokeWidth={1.75} />
              </span>
              <span
                className="hidden pr-3 text-sm font-medium md:block"
                style={{ opacity: 'var(--sidebar-initial-label-opacity, 1)' }}
              >
                Shared <span className="ml-1 font-mono text-[10px] font-normal opacity-50">(coming soon)</span>
              </span>
            </div>
          </div>
        </div>

        <div className="sidebar-initial-account-padding border-t border-[#D1CEC5] dark:border-night-border">
          <div className="flex items-center gap-3 overflow-hidden rounded-md p-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-xs text-paper dark:bg-paper dark:text-ink">?</div>
            <span
              className="hidden whitespace-nowrap text-xs font-bold text-ink md:block dark:text-paper"
              style={{ opacity: 'var(--sidebar-initial-label-opacity, 1)' }}
            >
              Account
            </span>
          </div>
        </div>
      </nav>
    )
  }

  const isLibraryActive = pathname === '/' || pathname === '/transcripts'

  // Motion is gated behind `motionReady` (armed one rAF after mount) so the
  // very first real-DOM paint lands at the persisted width with no transition
  // wired up — otherwise React reuses the SSR placeholder's <nav> node and a
  // collapsed-on-load sidebar would visibly animate 256px -> 64px.
  const navTransitionClass = motionReady
    ? 'transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] motion-reduce:transition-none'
    : ''
  const labelTransitionClass = motionReady
    ? 'transition-[opacity,transform] duration-200 motion-reduce:transition-none'
    : ''
  const labelStateClass = isCollapsed
    ? 'opacity-0 -translate-x-1 pointer-events-none delay-0'
    : 'opacity-100 translate-x-0 delay-100'
  const iconRotateTransitionClass = motionReady
    ? 'transition-transform duration-300 motion-reduce:transition-none'
    : ''
  // Sidebar-scoped tooltip delay: near-instant when collapsed (icons are the
  // only affordance), the app default (700ms, see app/layout.tsx) otherwise.
  const sidebarTooltipDelay = isCollapsed ? 150 : 700

  return (
    <nav
      className={`
        group/sidebar flex flex-col justify-between shrink-0 z-20
        bg-[#DFDCD4] dark:bg-night-surface border-r border-[#D1CEC5] dark:border-night-border
        ${navTransitionClass}
        ${isCollapsed ? 'w-16 md:w-14' : 'w-16 md:w-64'}
        ${className}
      `}
    >
      <TooltipProvider delayDuration={sidebarTooltipDelay}>
        {/* Logo Area */}
        <div className={`h-[56px] gap-2 flex items-center justify-between overflow-hidden transition-[padding] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] motion-reduce:transition-none ${isCollapsed ? 'px-3 md:px-2' : 'px-3'}`}>
          {isCollapsed ? (
            <>
              <button
                type="button"
                aria-label="Go to home"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md focus:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/50 md:hidden"
                onClick={() => navigateTo('/')}
              >
                <span className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="h-6 w-1 rounded-full bg-ink dark:bg-paper" />
                  <span className="h-2 w-2 rounded-xs bg-ember-red" />
                </span>
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-label="Expand Sidebar"
                    className="group/header-toggle relative hidden h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink hover:bg-ink/5 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/50 md:flex dark:text-paper dark:hover:bg-white/10"
                  >
                    <span className="absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-150 ease-out group-hover/header-toggle:scale-90 group-hover/header-toggle:opacity-0 group-focus-visible/header-toggle:scale-90 group-focus-visible/header-toggle:opacity-0 motion-reduce:transition-none">
                      <span className="flex items-center gap-1.5" aria-hidden="true">
                        <span className="h-6 w-1 rounded-full bg-ink dark:bg-paper" />
                        <span className="h-2 w-2 rounded-xs bg-ember-red" />
                      </span>
                    </span>
                    <PanelLeftOpen
                      className="h-[18px] w-[18px] scale-90 text-ink/50 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/header-toggle:scale-100 group-hover/header-toggle:opacity-100 group-focus-visible/header-toggle:scale-100 group-focus-visible/header-toggle:opacity-100 motion-reduce:transition-none dark:text-paper/50"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" align="center" sideOffset={10}>Expand Sidebar</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip open={false}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Go to home"
                    className="flex min-w-0 items-center overflow-hidden rounded-sm border-0 bg-transparent p-0 text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/50"
                    onClick={() => navigateTo('/')}
                  >
                    <span className="flex w-10 shrink-0 items-center justify-center" aria-hidden="true">
                      <span className="flex items-center gap-1.5">
                        <span className="h-6 w-1 rounded-full bg-ink dark:bg-paper" />
                        <span className="h-2 w-2 rounded-xs bg-ember-red" />
                      </span>
                    </span>
                    <h1 className={`hidden whitespace-nowrap font-serif text-2xl italic tracking-tight text-ink md:block dark:text-paper ${labelTransitionClass} ${labelStateClass}`}>
                      olivetti
                    </h1>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Home</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink/40 transition-colors duration-150 hover:bg-ink/5 active:scale-[0.98] motion-reduce:transition-none md:flex dark:text-paper/40 dark:hover:bg-white/10"
                    aria-label="Collapse Sidebar"
                  >
                    <PanelLeftClose
                      className={`h-[18px] w-[18px] ${iconRotateTransitionClass}`}
                      strokeWidth={1.75}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Collapse Sidebar</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        {/* Primary Nav */}
        <div className={`flex-1 pt-3 pb-6 space-y-1 transition-[padding] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] motion-reduce:transition-none ${isCollapsed ? 'px-3 md:px-2' : 'px-3'}`}>
          {/* Library */}
          <Tooltip disabled={!isCollapsed}>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigateTo('/')}
                aria-label="Library"
                className={`
                  w-full flex items-center py-2.5 rounded-md overflow-hidden whitespace-nowrap
                  transition-[background-color,border-color,color,transform] duration-150 ease-out motion-reduce:transition-none active:scale-[0.98]
                  ${isLibraryActive
                    ? 'bg-white/50 dark:bg-white/5 shadow-xs border border-[#D1CEC5] dark:border-night-border text-ink dark:text-paper'
                    : 'hover:bg-ink/5 dark:hover:bg-white/5 text-ink/70 dark:text-paper/70'
                  }
                `}
              >
                <span className="w-10 flex items-center justify-center shrink-0">
                  <Library className="w-[18px] h-[18px] opacity-60 group-hover:opacity-100" strokeWidth={1.75} />
                </span>
                <span
                  aria-hidden={isCollapsed}
                  className={`hidden md:block pr-3 font-medium text-sm ${labelTransitionClass} ${labelStateClass}`}
                >
                  Library
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" sideOffset={10}>Library</TooltipContent>
          </Tooltip>

          {/* Drafts - Coming Soon. `aria-disabled` keeps the real button focusable so
              keyboard users can still discover the explanatory tooltip. */}
          <Tooltip disabled={!isCollapsed}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-disabled="true"
                aria-label="Drafts (coming soon)"
                className="w-full flex items-center py-2.5 rounded-md cursor-not-allowed hover:bg-ink/5 dark:hover:bg-white/5 text-ink/70 dark:text-paper/70 overflow-hidden whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/50"
              >
                <span className="w-10 flex items-center justify-center shrink-0">
                  <PenLine className="w-[18px] h-[18px] opacity-60" strokeWidth={1.75} />
                </span>
                <span
                  aria-hidden={isCollapsed}
                  className={`hidden md:block pr-3 font-medium text-sm ${labelTransitionClass} ${labelStateClass}`}
                >
                  Drafts <span className="text-[10px] opacity-50 ml-1 font-normal font-mono">(coming soon)</span>
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" sideOffset={10}>Drafts — coming soon</TooltipContent>
          </Tooltip>

          {/* Shared - Coming Soon (same disabled-trigger pattern as Drafts). */}
          <Tooltip disabled={!isCollapsed}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-disabled="true"
                aria-label="Shared (coming soon)"
                className="w-full flex items-center py-2.5 rounded-md cursor-not-allowed hover:bg-ink/5 dark:hover:bg-white/5 text-ink/70 dark:text-paper/70 overflow-hidden whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/50"
              >
                <span className="w-10 flex items-center justify-center shrink-0">
                  <Users className="w-[18px] h-[18px] opacity-60" strokeWidth={1.75} />
                </span>
                <span
                  aria-hidden={isCollapsed}
                  className={`hidden md:block pr-3 font-medium text-sm ${labelTransitionClass} ${labelStateClass}`}
                >
                  Shared <span className="text-[10px] opacity-50 ml-1 font-normal font-mono">(coming soon)</span>
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" sideOffset={10}>Shared — coming soon</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {/* User / Bottom — full-width account row + upward menu (theme, sign out live inside).
          Rendered unconditionally so theme + sign out stay reachable while `user` is null. */}
      <div className={`border-t border-[#D1CEC5] dark:border-night-border transition-[padding] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] motion-reduce:transition-none ${isCollapsed ? 'p-2 md:p-1' : 'p-2'}`}>
        <AccountMenu
          user={user}
          isCollapsed={isCollapsed}
          theme={theme}
          supportsSystemTheme={supportsSystemTheme}
          onSetTheme={setThemePreference}
          onSignOut={handleSignOut}
        />
      </div>
    </nav>
  )
}
