'use client'

import { useState } from 'react'
import { countLabel } from '@/components/Projects/format'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { Tag } from '@/contracts/db'

/** A tag-level change waiting for confirmation: deleting a tag, or folding one into another. */
export type TagConfirm = { kind: 'delete'; tag: Tag } | { kind: 'merge'; from: Tag; into: Tag } | null

/**
 * Confirms deleting or merging a tag. Both change every transcript and can't
 * be undone, so the dialog says how many transcripts are affected. A refusal
 * shows in the dialog; success closes it.
 */
export function TagConfirmDialog({ confirm, countOf, onClose, onDelete, onMerge, onCloseAutoFocus }: {
  confirm: TagConfirm
  /** How many transcripts carry a tag. */
  countOf: (tagId: string) => number
  onClose: () => void
  /** Rejects with a message to show. */
  onDelete: (tag: Tag) => Promise<void>
  onMerge: (from: Tag, into: Tag) => Promise<void>
  onCloseAutoFocus?: (event: Event) => void
}) {
  // Keeps the text while the dialog fades out.
  const [last, setLast] = useState(confirm)
  if (confirm && confirm !== last) setLast(confirm)
  const shown = confirm ?? last
  if (!shown) return null

  const props = shown.kind === 'delete'
    ? {
        heading: `Delete ${shown.tag.name}?`,
        description: `It comes off ${countLabel(countOf(shown.tag.id), 'transcript', 'transcripts')}. No transcript is deleted.`,
        confirmLabel: 'Delete tag',
        pendingLabel: 'Deleting…',
        onConfirm: () => onDelete(shown.tag),
      }
    : {
        heading: `Merge ${shown.from.name} into ${shown.into.name}?`,
        description: `The ${countLabel(countOf(shown.from.id), 'transcript', 'transcripts')} tagged ${shown.from.name} will be tagged ${shown.into.name} instead, and ${shown.from.name} is deleted. This can't be undone.`,
        confirmLabel: 'Merge',
        pendingLabel: 'Merging…',
        onConfirm: () => onMerge(shown.from, shown.into),
      }

  return (
    <ConfirmDialog
      open={confirm !== null}
      onOpenChange={(open) => { if (!open) onClose() }}
      onCloseAutoFocus={onCloseAutoFocus}
      {...props}
    />
  )
}
