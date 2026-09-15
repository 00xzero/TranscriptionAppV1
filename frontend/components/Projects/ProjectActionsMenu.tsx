'use client'

import type { Project } from '@/contracts/db'
import { DestructiveMenuItem, RowActionsMenu } from '@/components/RowActionsMenu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

export function ProjectActionsMenu({
  project,
  onRename,
  onDelete,
}: {
  project: Project
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <RowActionsMenu label={project.name}>
      {project.deleting_at !== null ? (
        <DropdownMenuItem onSelect={onDelete}>Retry Delete</DropdownMenuItem>
      ) : (
        <>
          <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
          <DestructiveMenuItem onSelect={onDelete}>Delete</DestructiveMenuItem>
        </>
      )}
    </RowActionsMenu>
  )
}
