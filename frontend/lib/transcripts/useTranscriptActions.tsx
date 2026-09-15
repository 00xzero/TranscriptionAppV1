'use client'

import { useState } from 'react'
import { DeleteTranscriptDialog } from '@/components/DeleteTranscriptDialog'
import { MoveTranscriptDialog } from '@/components/Projects/MoveTranscriptDialog'
import { toast } from '@/components/ui/toaster'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import type { TranscriptActionTarget } from '@/lib/transcripts/actions'
import {
  DELETE_TRANSCRIPT_ERROR_MESSAGE,
  TRANSCRIPT_CLEANUP_PENDING_TOAST,
} from '@/lib/transcripts/deleteErrors'

type UseTranscriptActionsOptions = {
  onDeleted?: (target: TranscriptActionTarget) => void
}

export function useTranscriptActions({ onDeleted }: UseTranscriptActionsOptions = {}) {
  const { deleteTranscript } = useProjectsData()
  const [moveTarget, setMoveTarget] = useState<TranscriptActionTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TranscriptActionTarget | null>(null)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    let cleanupPendingKeys: string[]
    try {
      const result = await deleteTranscript(deleteTarget.id)
      cleanupPendingKeys = result.cleanupPendingKeys
    } catch (error) {
      console.error('Failed to delete transcript:', error)
      throw new Error(DELETE_TRANSCRIPT_ERROR_MESSAGE)
    }
    if (cleanupPendingKeys.length > 0) toast(TRANSCRIPT_CLEANUP_PENDING_TOAST)
    onDeleted?.(deleteTarget)
  }

  return {
    moveTarget,
    deleteTarget,
    openMove: setMoveTarget,
    openDelete: setDeleteTarget,
    closeMove: () => setMoveTarget(null),
    closeDelete: () => setDeleteTarget(null),
    confirmDelete,
  }
}

export function TranscriptActionDialogs({
  actions,
}: {
  actions: ReturnType<typeof useTranscriptActions>
}) {
  return (
    <>
      {actions.deleteTarget && (
        <DeleteTranscriptDialog
          open
          title={actions.deleteTarget.title}
          onOpenChange={(open) => !open && actions.closeDelete()}
          onConfirm={actions.confirmDelete}
        />
      )}
      {actions.moveTarget && (
        <MoveTranscriptDialog
          open
          onOpenChange={(open) => !open && actions.closeMove()}
          transcript={actions.moveTarget}
        />
      )}
    </>
  )
}
