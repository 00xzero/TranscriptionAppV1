'use client'

import { useState } from 'react'
import type { TranscriptActionTarget } from '@/lib/transcripts/actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { mapProjectWriteError } from '@/lib/supabase/project-errors'
import { isRealtimeScopeAbortError } from '@/lib/supabase/realtime'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { ProjectNameDialog } from './ProjectNameDialog'
import { ProjectTreePicker } from './ProjectTreePicker'

export function MoveTranscriptDialog({
  transcript,
  onClose,
}: {
  transcript: TranscriptActionTarget
  onClose: () => void
}) {
  const { tree, transcripts, createProject, moveTranscript } = useProjectsData()
  // The live row wins over the target snapshot, so a move made elsewhere is respected.
  const liveTranscript = transcripts.find((row) => row.id === transcript.id)
  const currentProjectId = liveTranscript ? liveTranscript.project_id : transcript.project_id
  const [selection, setSelection] = useState(currentProjectId)
  const [syncedProjectId, setSyncedProjectId] = useState(currentProjectId)
  // Follow a live move made elsewhere, unless the user has already picked another destination.
  if (syncedProjectId !== currentProjectId) {
    setSyncedProjectId(currentProjectId)
    if (selection === syncedProjectId) setSelection(currentProjectId)
  }
  const [createOpen, setCreateOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleMove = async () => {
    setPending(true)
    setError(null)
    try {
      await moveTranscript(transcript.id, selection)
      onClose()
    } catch (caught) {
      if (isRealtimeScopeAbortError(caught)) {
        onClose()
        return
      }
      setError(mapProjectWriteError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
        <DialogContent className="overflow-hidden p-0">
          <div className="space-y-4 px-6 pb-5 pt-6">
            <div>
              <DialogTitle>Move “{transcript.title}”</DialogTitle>
              <DialogDescription className="mt-1">Choose a new project or move it to Unfiled.</DialogDescription>
            </div>
            <ProjectTreePicker tree={tree} value={selection} onChange={setSelection} />
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setCreateOpen(true)}>
              New Project
            </Button>
            {error && <p role="alert" className="text-sm text-ember-red">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              disabled={pending || selection === currentProjectId}
              onClick={() => void handleMove()}
            >
              {pending ? 'Moving…' : 'Move'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ProjectNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        parentId={selection}
        onSubmit={async (name) => {
          const created = await createProject({ name, parent_id: selection })
          setSelection(created.id)
          return created
        }}
      />
    </>
  )
}
