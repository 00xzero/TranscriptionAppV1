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
  open,
  onOpenChange,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
}) {
  const { tree, mutateProjects, mutateTranscripts } = useProjectsData()
  const [transcriptCount, setTranscriptCount] = useState<number | null>(null)
  const [countError, setCountError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const projectId = project?.id

  useEffect(() => {
    if (!open || !projectId) return
    let active = true
    void fetchProjectBranchTranscriptCount(projectId).then(
      (count) => active && setTranscriptCount(count),
      () => active && setCountError('The transcript count could not be loaded. Close this dialog and try again.')
    )
    return () => { active = false }
  }, [open, projectId])

  const completeLocally = () => {
    if (!project) return
    const deletedIds = new Set(branchIds(tree, project.id))
    mutateProjects((current) => current.filter((item) => !deletedIds.has(item.id)))
    mutateTranscripts((current) => current.filter((item) => !item.project_id || !deletedIds.has(item.project_id)))
  }

  const handleConfirm = async () => {
    if (!project) return
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

  const nestedCount = project ? descendantCount(tree, project.id) : 0
  const description = countError ?? (transcriptCount === null
    ? 'Loading the number of transcripts in this project…'
    : `This will permanently delete ${nestedCount} nested ${nestedCount === 1 ? 'project' : 'projects'} and ${transcriptCount} ${transcriptCount === 1 ? 'transcript' : 'transcripts'}, including their media. This cannot be undone.`)

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      heading={project ? `Delete “${project.name}”?` : 'Delete project?'}
      description={description}
      onConfirm={handleConfirm}
      cancelLabel="Cancel"
      confirmLabel={attempts > 0 ? 'Retry Delete' : 'Delete Project'}
      pendingLabel="Deleting…"
      confirmDisabled={!project || transcriptCount === null || Boolean(countError)}
    />
  )
}
