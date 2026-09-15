'use client'

import { MoreVertical } from 'lucide-react'
import type { Project } from '@/contracts/db'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ProjectActionsMenu({
  project,
  onRename,
  onDelete,
}: {
  project: Project
  onRename: () => void
  onDelete: () => void
}) {
  const deleting = project.deleting_at !== null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="More options"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/40 transition-colors hover:bg-warm-highlight/50 hover:text-foreground dark:hover:bg-night-border/80"
          aria-label={`More options for ${project.name}`}
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {deleting ? (
          <DropdownMenuItem onSelect={onDelete}>Retry Delete</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem
              className="text-ember-red focus:bg-warm-highlight/70 focus:text-ember-red dark:focus:bg-night-border"
              onSelect={onDelete}
            >
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
