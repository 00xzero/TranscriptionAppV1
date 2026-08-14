"use client"

import React, { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useModal } from '@/lib/ModalContext'
import { createClient } from '@/infra/supabase/client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import RecordingPill from '@/components/RecordingSession/RecordingPill'
import type { User } from '@supabase/supabase-js'

interface ContextualHeaderProps {
  viewType?: 'library' | 'editor'
  transcriptTitle?: string
}

export default function ContextualHeader({ viewType, transcriptTitle }: ContextualHeaderProps) {
  const { openCaptureModal } = useModal()
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const pathname = usePathname()
  const isAuthRoute = pathname?.startsWith('/auth') ?? false

  // Auto-detect editor mode from pathname if viewType not explicitly set
  const isEditorRoute = pathname?.startsWith('/editor/')
  const effectiveViewType = viewType ?? (isEditorRoute ? 'editor' : 'library')
  const handleEditorTopReset = () => {
    window.dispatchEvent(new CustomEvent('editor-scroll-to-top'))
  }

  // Check authentication status
  // Create Supabase client inside useEffect to avoid SSR/hydration issues
  useEffect(() => {
    if (isAuthRoute) {
      setUser(null)
      setIsLoading(false)
      return
    }

    const supabase = createClient()
    let isMounted = true

    const getUser = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (isMounted) {
          setUser(user)
        }
      } catch {
        if (isMounted) {
          setUser(null)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }
    void getUser()

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUser(session?.user ?? null)
        setIsLoading(false)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [isAuthRoute])

  return (
    <header className="h-[var(--header-height)] border-b border-border bg-paper/45 dark:bg-night-surface/45 backdrop-blur-md flex items-center justify-between px-6 z-10 transition-colors duration-300">
      {/* Left: Logo (when unauthenticated) or View Title / Breadcrumbs (when authenticated) */}
      <div className="flex items-center gap-2">
        {isLoading ? (
          <div className="h-6 w-28" aria-hidden="true" />
        ) : !user ? (
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
        ) : effectiveViewType === 'library' ? (
          <span className="font-serif text-xl italic text-ink dark:text-paper">
            Library
          </span>
        ) : (
          <div className="flex items-center gap-[5px]">
            <span className="font-sans text-[12px] leading-[20px] text-ink/50 dark:text-paper/50">
              Library
            </span>
            <span className="font-sans text-[12px] leading-[20px] text-ink/50 dark:text-paper/50">
              /
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="font-sans font-medium text-[12px] leading-[20px] text-ink dark:text-paper bg-transparent border-0 p-0 m-0"
                  onClick={handleEditorTopReset}
                  aria-label="Scroll to the top of the transcript"
                >
                  {transcriptTitle || 'Transcript'}
                </button>
              </TooltipTrigger>
              <TooltipContent>Scroll to top</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Right: Editor actions (Find/Replace + Export) */}
      {user && effectiveViewType === 'editor' && (
        <div className="flex items-center gap-2">
          <RecordingPill />
          {/* Export icon button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="group h-[30px] w-[30px] rounded-md border border-subtle-border bg-field/10 backdrop-blur-xs transition-all hover:border-trust-blue/30 hover:bg-field active:scale-95 dark:bg-subtle dark:hover:bg-surface"
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
      {user && effectiveViewType !== 'editor' && (
        <div className="flex items-center gap-6">
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                onClick={() => openCaptureModal()}
                aria-label="Open capture modal"
                className="gap-2 hover:shadow-md"
              >
                <div className="h-2 w-2 animate-pulse rounded-full bg-solid-foreground" />
                <span className="hidden md:inline">Capture</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Start new recording</TooltipContent>
          </Tooltip>
        </div>
      )}
    </header>
  )
}
