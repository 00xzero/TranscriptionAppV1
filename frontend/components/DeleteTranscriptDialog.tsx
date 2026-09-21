"use client"

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const DELETE_TRANSCRIPT_DESCRIPTION =
  'This will permanently remove the transcript and all associated data. This action cannot be undone.'

type DeleteTranscriptDialogProps = {
  open: boolean
  /** Transcript title shown in the heading. */
  title: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

/**
 * Single source of truth for the "delete transcript" confirmation so every
 * entry point (library cards, transcripts page) shows the exact same dialog.
 */
export function DeleteTranscriptDialog({
  open,
  title,
  onOpenChange,
  onConfirm,
}: DeleteTranscriptDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      heading={`Delete "${title}"?`}
      description={DELETE_TRANSCRIPT_DESCRIPTION}
      onConfirm={onConfirm}
      confirmLabel="Delete"
      pendingLabel="Deleting…"
    />
  )
}
