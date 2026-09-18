'use client'

import { DeleteTranscriptDialog } from '@/components/DeleteTranscriptDialog'
import { MoveTranscriptDialog } from '@/components/Projects/MoveTranscriptDialog'
import { toast } from '@/components/ui/toaster'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { isRealtimeScopeAbortError } from '@/lib/supabase/realtime'
import {
  DELETE_TRANSCRIPT_ERROR_MESSAGE,
  TRANSCRIPT_CLEANUP_PENDING_TOAST,
} from '@/lib/transcripts/deleteErrors'
import type { TranscriptActions } from '@/lib/transcripts/useTranscriptActions'

/**
 * The one Move and one Delete dialog a surface mounts for all of its transcript rows.
 * Reading provider data here keeps the owning surface off the context subscription.
 */
export function TranscriptActionDialogs({
  actions,
  onDeleted,
}: {
  actions: TranscriptActions
  onDeleted?: () => void
}) {
  const { deleteTranscript } = useProjectsData()
  const { moveTarget, deleteTarget } = actions

  const confirmDelete = async (id: string) => {
    let cleanupPendingKeys: string[]
    try {
      ({ cleanupPendingKeys } = await deleteTranscript(id))
    } catch (error) {
      if (isRealtimeScopeAbortError(error)) {
        actions.closeDelete()
        return
      }
      console.error('Failed to delete transcript:', error)
      throw new Error(DELETE_TRANSCRIPT_ERROR_MESSAGE)
    }
    if (cleanupPendingKeys.length > 0) toast(TRANSCRIPT_CLEANUP_PENDING_TOAST)
    onDeleted?.()
  }

  return (
    <>
      {deleteTarget && (
        <DeleteTranscriptDialog
          open
          title={deleteTarget.title}
          onOpenChange={(open) => !open && actions.closeDelete()}
          onConfirm={() => confirmDelete(deleteTarget.id)}
        />
      )}
      {moveTarget && <MoveTranscriptDialog transcript={moveTarget} onClose={actions.closeMove} />}
    </>
  )
}
