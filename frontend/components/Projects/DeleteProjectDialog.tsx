'use client'

import { useEffect, useState } from 'react'
import type { Project } from '@/contracts/db'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { countLabel } from '@/components/Projects/format'
import { branchIds, descendantCount } from '@/core/projects/tree'
import { deleteProjectRequest, DeleteProjectRequestError } from '@/lib/projects/delete-client'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { fetchProjectBranchTranscriptCount } from '@/lib/supabase/queries'

function deleteErrorMessage(error: unknown): string {
  if (!(error instanceof DeleteProjectRequestError)) {
    return 'The project could not be deleted. Try again.'
  }
  if (error.stage === 'storage') {
    return `${error.message} Removed ${countLabel(error.removedMedia ?? 0, 'media file', 'media files')} and ${countLabel(error.removedWaveforms ?? 0, 'waveform file', 'waveform files')}; ${countLabel(error.remainingTranscripts ?? 0, 'transcript remains', 'transcripts remain')}.`
  }
  return error.message
}

export function DeleteProjectDialog({
  project,
  onClose,
}: {
  project: Project
  onClose: () => void
}) {
  const { tree, mutateProjects, mutateTranscripts } = useProjectsData()
  const [transcriptCount, setTranscriptCount] = useState<number | null>(null)
  const [countError, setCountError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    let active = true
    void fetchProjectBranchTranscriptCount(project.id).then(
      (count) => active && setTranscriptCount(count),
      () => active && setCountError('The transcript count could not be loaded. Close this dialog and try again.')
    )
    return () => { active = false }
  }, [project.id])

  const completeLocally = () => {
    const deletedIds = new Set(branchIds(tree, project.id))
    mutateProjects((current) => current.filter((item) => !deletedIds.has(item.id)))
    mutateTranscripts((current) => current.filter((item) => !item.project_id || !deletedIds.has(item.project_id)))
  }

  const handleConfirm = async () => {
    try {
      await deleteProjectRequest(project.id)
      completeLocally()
    } catch (error) {
      if (error instanceof DeleteProjectRequestError && error.gone) {
        completeLocally()
        return
      }
      setAttempts((current) => current + 1)
      throw new Error(deleteErrorMessage(error))
    }
  }

  const nestedCount = descendantCount(tree, project.id)
  const description = countError ?? (transcriptCount === null
    ? 'Loading the number of transcripts in this project…'
    : `This will permanently delete ${countLabel(nestedCount, 'nested project', 'nested projects')} and ${countLabel(transcriptCount, 'transcript', 'transcripts')}, including their media. This cannot be undone.`)

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      heading={`Delete “${project.name}”?`}
      description={description}
      onConfirm={handleConfirm}
      confirmLabel={attempts > 0 ? 'Retry Delete' : 'Delete Project'}
      pendingLabel="Deleting…"
      confirmDisabled={transcriptCount === null || Boolean(countError)}
    />
  )
}
