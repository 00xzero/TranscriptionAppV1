"use client"

import React, { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useModal } from '@/lib/ModalContext'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

interface ContextualHeaderProps {
  viewType?: 'library' | 'editor'
  projectTitle?: string
}

export default function ContextualHeader({ viewType, projectTitle }: ContextualHeaderProps) {
  const { openCaptureModal } = useModal()
  const [user, setUser] = useState<User | null>(null)
  const pathname = usePathname()

  // Auto-detect editor mode from pathname if viewType not explicitly set
  const isEditorRoute = pathname?.startsWith('/editor/')
  const effectiveViewType = viewType ?? (isEditorRoute ? 'editor' : 'library')

  // Check authentication status
  // Create Supabase client inside useEffect to avoid SSR/hydration issues
  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return

    const supabase = createClient()
    let isMounted = true

    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (isMounted) {
        setUser(user)
      }
    }
    getUser()

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUser(session?.user ?? null)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  return (
    <header className="h-[56px] border-b border-[#D1CEC5] dark:border-night-border bg-paper/80 dark:bg-[#1A1A1A]/45 backdrop-blur-md flex items-center justify-between px-6 z-10 transition-colors duration-300">
      {/* Left: Logo (when unauthenticated) or View Title / Breadcrumbs (when authenticated) */}
      <div className="flex items-center gap-2">
        {!user ? (
          // Olivetti Logo - shown when not authenticated
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="h-6 w-1 bg-ink dark:bg-paper rounded-full" />
              <div className="h-2 w-2 bg-ember-red rounded-sm" />
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
            <span className="font-sans font-medium text-[12px] leading-[20px] text-ink dark:text-paper">
              {projectTitle || 'Project'}
            </span>
          </div>
        )}
      </div>

      {/* Right: Editor actions (Find/Replace + Export) */}
      {user && effectiveViewType === 'editor' && (
        <div className="flex items-center gap-2">
          {/* Export icon button */}
          <button
            className="group w-[30px] h-[30px] rounded-[6px] bg-white/10 dark:bg-white/5 border border-ink/10 dark:border-white/10 flex items-center justify-center hover:bg-white hover:border-trust-blue/30 dark:hover:bg-[#1D1E18] backdrop-blur-sm transition-all active:scale-95"
            onClick={() => window.dispatchEvent(new CustomEvent('open-export'))}
            title="Export"
            aria-label="Export"
          >
            <svg
              className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-hover:text-trust-blue transition-all"
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

          {/* Find & Replace button */}
          <button
            className="group box-border w-[172px] h-[30px] bg-white/10 dark:bg-white/5 border border-ink/10 dark:border-white/10 rounded-[6px] flex items-center justify-between px-[13px] hover:bg-white hover:border-trust-blue/30 dark:hover:bg-[#1D1E18] backdrop-blur-sm shadow-sm transition-all active:scale-95"
            onClick={() =>
              window.dispatchEvent(new CustomEvent('open-find-replace'))
            }
            title="Find & Replace"
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
              <span className="font-sans text-[10px] leading-[16px] text-ink/50 dark:text-paper/50 whitespace-nowrap">
                Find & Replace
              </span>
            </div>
            <div className="bg-ink/5 dark:bg-white/5 rounded-[4px] h-[15px] px-[6px] flex items-center justify-center">
              <span className="font-sans text-[8.5px] text-ink/50 dark:text-paper/50 leading-[15px]">
                {'\u2318'}F
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Right: Search + Capture Button - Only show when authenticated and on library route */}
      {user && effectiveViewType !== 'editor' && (
        <div className="flex items-center gap-6">
          {/* Global Search - Desktop Only */}
          <div className="relative hidden md:flex items-center gap-3 bg-white/50 dark:bg-white/5 border border-[#D1CEC5] dark:border-night-border rounded-lg px-3 py-1.5 focus-within:border-trust-blue/50 focus-within:bg-white dark:focus-within:bg-[#1A1A1A] transition-all group">
            <span className="font-mono text-[10px] text-ink/40 dark:text-paper/40 group-focus-within:text-trust-blue transition-colors">
              ?
            </span>
            <input
              type="text"
              placeholder="Recall a decision..."
              aria-label="Recall a decision..."
              className="bg-transparent border-none w-56 text-sm font-serif italic focus:outline-none focus:ring-0 placeholder-ink/30 dark:placeholder-paper/20 text-ink dark:text-paper"
            />
          </div>

          {/* Capture Button */}
          <button
            onClick={openCaptureModal}
            className="bg-ember-red text-white px-4 py-2 rounded shadow-sm hover:shadow-md active:scale-95 transition-all flex items-center gap-2 font-medium text-sm"
          >
            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
            <span className="hidden md:inline">Capture</span>
          </button>
        </div>
      )}
    </header>
  )
}
