"use client"

import * as React from 'react'
import type { User } from '@supabase/supabase-js'
import { User as UserIcon, Settings, Moon, Sun, Monitor, LogOut, ChevronsUpDown } from 'lucide-react'
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

const avatarClass =
  'w-8 h-8 rounded-full bg-ink dark:bg-paper text-paper dark:text-ink flex items-center justify-center font-mono text-xs shrink-0'

const themeToggleMetrics = {
  '--theme-toggle-item-size': '1.75rem',
  '--theme-toggle-item-gap': '0.125rem',
} as React.CSSProperties

const THEME_OPTIONS: { value: AppTheme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
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
              <opt.icon className="w-4 h-4" strokeWidth={1.75} />
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
          className="
            w-full flex items-center justify-start gap-3 rounded-md p-2 text-left overflow-hidden transition-colors
            hover:bg-ink/5 dark:hover:bg-white/5
            data-[state=open]:bg-ink/5 dark:data-[state=open]:bg-white/5
            focus:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/50
          "
        >
          <div className={avatarClass}>{initials}</div>
          {/* Name/email/affordance — always mounted (opacity/translate animate on collapse) so it
              glides in step with the sidebar's own labels instead of popping in. Mobile stays
              avatar-only via `hidden md:flex`. */}
          <div
            aria-hidden={isCollapsed}
            className={`
              hidden md:flex flex-1 min-w-0 items-center gap-2
              transition-[opacity,transform] duration-200 motion-reduce:transition-none
              ${isCollapsed ? 'opacity-0 -translate-x-1 pointer-events-none delay-0' : 'opacity-100 translate-x-0 delay-100'}
            `}
          >
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
            <ChevronsUpDown className="w-4 h-4 text-ink/40 dark:text-paper/40 shrink-0" strokeWidth={1.75} />
          </div>
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
          <UserIcon className="w-4 h-4 opacity-60 shrink-0" strokeWidth={1.75} />
          <span>Profile</span>
          <span className="text-[10px] opacity-50 ml-auto font-normal font-mono">(coming soon)</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="gap-2.5">
          <Settings className="w-4 h-4 opacity-60 shrink-0" strokeWidth={1.75} />
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
          <LogOut className="w-4 h-4 opacity-60 shrink-0" strokeWidth={1.75} />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
