'use client'

import type { ReactNode } from 'react'
import { MoreVertical } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** The "More options" kebab menu shared by transcript and project rows. */
export function RowActionsMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="More options"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/40 transition-colors hover:bg-warm-highlight/50 hover:text-foreground dark:hover:bg-night-border/80"
          aria-label={`More options for ${label}`}
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DestructiveMenuItem({ onSelect, children }: { onSelect: () => void; children: ReactNode }) {
  return (
    <DropdownMenuItem
      className="text-ember-red focus:bg-warm-highlight/70 focus:text-ember-red dark:focus:bg-night-border"
      onSelect={onSelect}
    >
      {children}
    </DropdownMenuItem>
  )
}
