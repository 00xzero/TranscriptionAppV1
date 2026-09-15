'use client'

import { DestructiveMenuItem, RowActionsMenu } from '@/components/RowActionsMenu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

export function TranscriptActionsMenu({
  title,
  onMove,
  onDelete,
}: {
  title: string
  onMove: () => void
  onDelete: () => void
}) {
  return (
    <RowActionsMenu label={title}>
      <DropdownMenuItem onSelect={onMove}>Move to Project…</DropdownMenuItem>
      <DestructiveMenuItem onSelect={onDelete}>Delete</DestructiveMenuItem>
    </RowActionsMenu>
  )
}
