import { useState } from 'react'
import type { TranscriptActionTarget } from '@/lib/transcripts/actions'

/** Which transcript, if any, a surface's single Move or Delete dialog is open for. */
export function useTranscriptActions() {
  const [moveTarget, setMoveTarget] = useState<TranscriptActionTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TranscriptActionTarget | null>(null)

  return {
    moveTarget,
    deleteTarget,
    openMove: setMoveTarget,
    openDelete: setDeleteTarget,
    closeMove: () => setMoveTarget(null),
    closeDelete: () => setDeleteTarget(null),
  }
}

export type TranscriptActions = ReturnType<typeof useTranscriptActions>
