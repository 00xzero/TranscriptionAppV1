"use client"

import * as React from 'react'
import type { User } from '@supabase/supabase-js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AppTheme } from '@/types/theme'

interface AccountMenuProps {
  /** Nullable so the theme toggle + sign out stay reachable while getUser() is loading or has failed. */
  user: User | null
  isCollapsed: boolean
  /** Current theme preference: 'light' | 'dark' | 'system'. */
  theme: AppTheme
  supportsSystemTheme: boolean
  onSetTheme: (theme: AppTheme) => void
  /** Sidebar's guarded handleSignOut — passed through unchanged (recording-artifact guard lives there). */
  onSignOut: () => void
}

// Derive up-to-two-letter initials, falling back to '?' when there is no user yet.
function getUserInitials(user: User | null): string {
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

// Heroicons v2 (outline) path data — rendered at 16px with currentColor to match the sidebar's SVG chevron.
const ICON_PATHS = {
  user: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0',
  settings:
    'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.397-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  moon: 'M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z',
  sun: 'M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z',
  system:
    'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z',
  signOut:
    'M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9',
  unfold: 'M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9',
} as const

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

const avatarClass =
  'w-8 h-8 rounded-full bg-ink dark:bg-paper text-paper dark:text-ink flex items-center justify-center font-mono text-xs shrink-0'

const themeToggleMetrics = {
  '--theme-toggle-item-size': '1.75rem',
  '--theme-toggle-item-gap': '0.125rem',
} as React.CSSProperties

const THEME_OPTIONS: { value: AppTheme; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: ICON_PATHS.sun },
  { value: 'dark', label: 'Dark', icon: ICON_PATHS.moon },
  { value: 'system', label: 'System', icon: ICON_PATHS.system },
]

// Inline three-way theme control. The options are Radix radio menu items styled
// as segmented buttons, so they keep the menu's keyboard model while preserving
// the compact toggle-button feel.
function ThemeToggle({
  theme,
  supportsSystemTheme,
  onSetTheme,
}: {
  theme: AppTheme
  supportsSystemTheme: boolean
  onSetTheme: (theme: AppTheme) => void
}) {
  const options = supportsSystemTheme
    ? THEME_OPTIONS
    : THEME_OPTIONS.filter((opt) => opt.value !== 'system')
  const activeIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === theme)
  )
  const optionRefs = React.useRef<Array<HTMLDivElement | null>>([])

  const selectOption = React.useCallback(
    (index: number) => {
      const nextIndex = (index + options.length) % options.length
      const nextOption = options[nextIndex]
      if (!nextOption) return
      onSetTheme(nextOption.value)
      requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus())
    },
    [onSetTheme, options]
  )

  const handleOptionKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
      // Horizontal keys cycle the segments (radiogroup feel). Up/Down are left
      // to Radix so they navigate between menu rows — stopPropagation() here
      // keeps Radix from also acting on the keys we handle. Do NOT handle
      // ArrowUp/ArrowDown, or vertical menu navigation gets trapped in the group.
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault()
          event.stopPropagation()
          selectOption(index + 1)
          break
        case 'ArrowLeft':
          event.preventDefault()
          event.stopPropagation()
          selectOption(index - 1)
          break
        case 'Home':
          event.preventDefault()
          event.stopPropagation()
          selectOption(0)
          break
        case 'End':
          event.preventDefault()
          event.stopPropagation()
          selectOption(options.length - 1)
          break
      }
    },
    [options.length, selectOption]
  )

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-xs text-ink/60 dark:text-paper/60">Appearance</span>
      <DropdownMenuRadioGroup
        value={theme}
        onValueChange={(value) => onSetTheme(value as AppTheme)}
        aria-label="Appearance"
        className="relative ml-auto flex items-center gap-[var(--theme-toggle-item-gap)] rounded-md border border-ink/10 dark:border-white/10 p-0.5"
        style={themeToggleMetrics}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0.5 top-0.5 h-[var(--theme-toggle-item-size)] w-[var(--theme-toggle-item-size)] rounded bg-ink transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-paper"
          style={{
            transform: `translateX(calc(${activeIndex} * (var(--theme-toggle-item-size) + var(--theme-toggle-item-gap))))`,
          }}
        />
        {options.map((opt, index) => {
          const active = theme === opt.value
          return (
            <DropdownMenuRadioItem
              key={opt.value}
              value={opt.value}
              textValue={opt.label}
              ref={(node) => {
                optionRefs.current[index] = node
              }}
              aria-label={opt.label}
              onSelect={(event) => event.preventDefault()}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              className={`relative z-10 flex h-[var(--theme-toggle-item-size)] w-[var(--theme-toggle-item-size)] items-center justify-center rounded transition-colors focus:outline-hidden data-[highlighted]:ring-1 data-[highlighted]:ring-inset data-[highlighted]:ring-ink/15 dark:data-[highlighted]:ring-paper/20 ${
                active
                  ? 'text-paper dark:text-ink'
                  : 'text-ink/50 dark:text-paper/50 hover:bg-ink/5 data-[highlighted]:bg-ink/5 dark:hover:bg-white/5 dark:data-[highlighted]:bg-white/5'
              }`}
            >
              <Icon path={opt.icon} className="w-4 h-4" />
            </DropdownMenuRadioItem>
          )
        })}
      </DropdownMenuRadioGroup>
    </div>
  )
}

export default function AccountMenu({
  user,
  isCollapsed,
  theme,
  supportsSystemTheme,
  onSetTheme,
  onSignOut,
}: AccountMenuProps) {
  const initials = getUserInitials(user)
  const displayName =
    user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Account'
  const email = user?.email ?? ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={`
            w-full flex items-center gap-3 rounded-md p-2 text-left transition-colors
            hover:bg-ink/5 dark:hover:bg-white/5
            data-[state=open]:bg-ink/5 dark:data-[state=open]:bg-white/5
            focus:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/50
            ${isCollapsed ? 'justify-center' : 'justify-center md:justify-start'}
          `}
        >
          <div className={avatarClass}>{initials}</div>
          {/* Name/email/affordance — hidden on the collapsed rail and on mobile (avatar-only trigger). */}
          {!isCollapsed && (
            <div className="hidden md:flex flex-1 min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-ink dark:text-paper truncate">
                  {displayName}
                </p>
                {email && (
                  <p className="text-[10px] text-ink/50 dark:text-paper/50 font-mono truncate">
                    {email}
                  </p>
                )}
              </div>
              <Icon path={ICON_PATHS.unfold} className="w-4 h-4 text-ink/40 dark:text-paper/40 shrink-0" />
            </div>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-60">
        {/* Identity header — non-interactive, slightly taller than the action rows. */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className={avatarClass}>{initials}</div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink dark:text-paper truncate">{displayName}</p>
            {email && (
              <p className="text-xs text-ink/50 dark:text-paper/50 font-mono truncate">{email}</p>
            )}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Profile & Settings — disabled placeholders, matching the sidebar's "coming soon" convention. */}
        <DropdownMenuItem disabled className="gap-2.5">
          <Icon path={ICON_PATHS.user} className="w-4 h-4 opacity-60 shrink-0" />
          <span>Profile</span>
          <span className="text-[10px] opacity-50 ml-auto font-normal font-mono">(coming soon)</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="gap-2.5">
          <Icon path={ICON_PATHS.settings} className="w-4 h-4 opacity-60 shrink-0" />
          <span>Settings</span>
          <span className="text-[10px] opacity-50 ml-auto font-normal font-mono">(coming soon)</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Appearance — inline three-way toggle (buttons keep the menu open). */}
        <ThemeToggle
          theme={theme}
          supportsSystemTheme={supportsSystemTheme}
          onSetTheme={onSetTheme}
        />

        <DropdownMenuSeparator />

        <DropdownMenuItem className="gap-2.5" onSelect={() => onSignOut()}>
          <Icon path={ICON_PATHS.signOut} className="w-4 h-4 opacity-60 shrink-0" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
