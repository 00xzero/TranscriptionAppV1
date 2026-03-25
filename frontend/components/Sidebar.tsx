"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/infra/supabase/client'
import type { User } from '@supabase/supabase-js'

// Storage key for sidebar collapsed state
const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed'

// Theme helpers
type AppTheme = 'light' | 'dark'

function applyTheme(theme: AppTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try { localStorage.setItem('app-theme', theme) } catch { }
}

function detectInitialTheme(): AppTheme {
  try {
    const saved = localStorage.getItem('app-theme')
    if (saved === 'light' || saved === 'dark') return saved
    if (saved === 'blue') return 'dark' // backward compat
  } catch { }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

interface SidebarProps {
  className?: string
}

export default function Sidebar({ className = '' }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [theme, setTheme] = useState<AppTheme>('light')
  const [user, setUser] = useState<User | null>(null)
  const [mounted, setMounted] = useState(false)

  // Initialize state from localStorage after mount
  useEffect(() => {
    setMounted(true)
    // Load collapsed state
    try {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      if (saved === 'true') setIsCollapsed(true)
    } catch { }
    // Load theme
    const initialTheme = detectInitialTheme()
    setTheme(initialTheme)
    applyTheme(initialTheme)
  }, [])

  // Fetch user
  useEffect(() => {
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
  }, [])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const newValue = !prev
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newValue)) } catch { }
      return newValue
    })
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: AppTheme = prev === 'light' ? 'dark' : 'light'
      applyTheme(next)
      return next
    })
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  const navigateTo = (path: string) => {
    router.push(path)
  }

  // Get user initials
  const getUserInitials = (): string => {
    if (!user) return '?'
    const email = user.email || ''
    const name = (user.user_metadata?.full_name || email || '?').trim()

    if (!name) return '?'

    if (name.includes(' ')) {
      const parts = name.split(' ').filter((part: string) => part.length > 0)
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      }
    }

    const initials = name.substring(0, 2).toUpperCase()
    return initials.length > 0 ? initials : '?'
  }

  // Don't show sidebar on auth pages
  if (pathname?.startsWith('/auth')) {
    return null
  }

  // SSR placeholder
  if (!mounted) {
    return (
      <nav className={`w-16 md:w-64 bg-[#DFDCD4] dark:bg-night-surface border-r border-[#D1CEC5] dark:border-night-border flex-shrink-0 ${className}`} />
    )
  }

  const isLibraryActive = pathname === '/' || pathname === '/projects'

  return (
    <nav
      className={`
        group/sidebar flex flex-col justify-between flex-shrink-0 z-20
        bg-[#DFDCD4] dark:bg-night-surface border-r border-[#D1CEC5] dark:border-night-border
        transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)]
        ${isCollapsed ? 'w-16' : 'w-16 md:w-64'}
        ${className}
      `}
    >
      {/* Logo Area */}
      <div
        className={`
          h-[56px] px-4 border-b border-[#D1CEC5] dark:border-night-border 
          flex items-center justify-between
          transition-[padding] duration-300
          ${isCollapsed ? 'md:px-3' : 'md:px-6'}
        `}
      >
        <button
          type="button"
          aria-label="Go to home"
          title="Home"
          className="flex items-center gap-3 text-left rounded bg-transparent border-0 p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/50"
          onClick={() => navigateTo('/')}
        >
          {/* Logo Icon */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="h-6 w-1 bg-ink dark:bg-paper rounded-full" />
            <div className="h-2 w-2 bg-ember-red rounded-sm" />
          </div>
          {/* Wordmark - hidden when collapsed */}
          {!isCollapsed && (
            <h1 className="font-serif text-2xl italic text-ink dark:text-paper hidden md:block tracking-tight whitespace-nowrap overflow-hidden transition-all duration-200">
              olivetti
            </h1>
          )}
        </button>

        {/* Collapse Toggle Button - Desktop Only */}
        <button
          onClick={toggleCollapsed}
          className="hidden md:flex items-center justify-center w-6 h-6 rounded hover:bg-ink/5 dark:hover:bg-white/10 text-ink/40 dark:text-paper/40 transition-colors"
          title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Primary Nav */}
      <div className={`flex-1 py-6 space-y-1 px-2 ${isCollapsed ? '' : 'md:px-4'}`}>
        {/* Library */}
        <button
          onClick={() => navigateTo('/')}
          aria-label="Library"
          title="Library"
          className={`
            w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all overflow-hidden whitespace-nowrap
            ${isCollapsed ? 'justify-center' : 'md:justify-start'}
            ${isLibraryActive
              ? 'bg-white/50 dark:bg-white/5 shadow-sm border border-[#D1CEC5] dark:border-night-border text-ink dark:text-paper'
              : 'hover:bg-ink/5 dark:hover:bg-white/5 text-ink/70 dark:text-paper/70'
            }
          `}
        >
          <span className="font-mono text-lg opacity-60 group-hover:opacity-100 flex-shrink-0">❖</span>
          {!isCollapsed && (
            <span className="hidden md:block font-medium text-sm transition-opacity duration-200">Library</span>
          )}
        </button>

        {/* Drafts - Coming Soon */}
        <button
          aria-label="Drafts (coming soon)"
          title="Drafts (coming soon)"
          className={`
            w-full flex items-center gap-3 px-3 py-2.5 rounded-md 
            hover:bg-ink/5 dark:hover:bg-white/5 text-ink/70 dark:text-paper/70 
            transition-all overflow-hidden whitespace-nowrap cursor-not-allowed
            ${isCollapsed ? 'justify-center' : 'md:justify-start'}
          `}
          disabled
        >
          <span className="font-mono text-lg opacity-60 flex-shrink-0">¶</span>
          {!isCollapsed && (
            <span className="hidden md:block font-medium text-sm transition-opacity duration-200">
              Drafts <span className="text-[10px] opacity-50 ml-1 font-normal font-mono">(coming soon)</span>
            </span>
          )}
        </button>

        {/* Shared - Coming Soon */}
        <button
          aria-label="Shared (coming soon)"
          title="Shared (coming soon)"
          className={`
            w-full flex items-center gap-3 px-3 py-2.5 rounded-md 
            hover:bg-ink/5 dark:hover:bg-white/5 text-ink/70 dark:text-paper/70 
            transition-all overflow-hidden whitespace-nowrap cursor-not-allowed
            ${isCollapsed ? 'justify-center' : 'md:justify-start'}
          `}
          disabled
        >
          <span className="font-mono text-lg opacity-60 flex-shrink-0">@</span>
          {!isCollapsed && (
            <span className="hidden md:block font-medium text-sm transition-opacity duration-200">
              Shared <span className="text-[10px] opacity-50 ml-1 font-normal font-mono">(coming soon)</span>
            </span>
          )}
        </button>
      </div>

      {/* User / Bottom */}
      <div
        className={`
          p-4 border-t border-[#D1CEC5] dark:border-night-border overflow-hidden whitespace-nowrap flex flex-col
          ${isCollapsed ? 'items-center px-2' : 'md:items-start'}
        `}
      >
        {user && (
          <div
            className={`
              flex items-center gap-3 mb-4
              ${isCollapsed ? 'justify-center mb-0' : 'md:justify-start'}
            `}
          >
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-ink dark:bg-paper text-paper dark:text-ink flex items-center justify-center font-mono text-xs flex-shrink-0">
              {getUserInitials()}
            </div>
            {/* User Info - hidden when collapsed */}
            {!isCollapsed && (
              <div className="hidden md:block transition-opacity duration-200">
                <p className="text-xs font-bold text-ink dark:text-paper truncate max-w-[140px]">
                  {user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'}
                </p>
                <button
                  onClick={handleSignOut}
                  title="Sign out"
                  className="text-[10px] text-ink/50 dark:text-paper/50 font-mono hover:text-ink dark:hover:text-paper transition-colors"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          aria-label={theme === 'light' ? 'Switch to Night Mode' : 'Switch to Day Mode'}
          className={`
            w-full flex items-center gap-3 px-2 py-1.5 rounded 
            hover:bg-ink/5 dark:hover:bg-white/5 text-ink/60 dark:text-paper/60 
            transition-colors overflow-hidden whitespace-nowrap
            ${isCollapsed ? 'justify-center mt-4' : 'justify-center md:justify-start'}
          `}
          title={theme === 'light' ? 'Switch to Night Mode' : 'Switch to Day Mode'}
        >
          <span className="font-mono text-xs flex-shrink-0">
            {theme === 'light' ? '☾' : '☀'}
          </span>
          {!isCollapsed && (
            <span className="hidden md:block text-[10px] font-mono uppercase tracking-wide transition-opacity duration-200">
              {theme === 'light' ? 'Night Mode' : 'Day Mode'}
            </span>
          )}
        </button>
      </div>
    </nav>
  )
}
