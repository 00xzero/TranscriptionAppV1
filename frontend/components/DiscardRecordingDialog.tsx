"use client"

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const DISCARD_RECORDING_HEADING = 'Discard this recording?'
const DISCARD_RECORDING_DESCRIPTION =
  'The recording will be permanently lost and cannot be recovered.'

type DiscardRecordingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

/**
 * Single source of truth for the "discard recording" confirmation so every
 * entry point (in-recording discard, return-to-library) shows the exact same
 * dialog — bold heading + body, mirroring DeleteTranscriptDialog.
 */
export function DiscardRecordingDialog({
  open,
  onOpenChange,
  onConfirm,
}: DiscardRecordingDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      heading={DISCARD_RECORDING_HEADING}
      description={DISCARD_RECORDING_DESCRIPTION}
      onConfirm={onConfirm}
      confirmLabel="Discard"
    />
  )
}
