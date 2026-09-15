'use client'

import { useState } from 'react'
import type { TranscriptActionTarget } from '@/lib/transcripts/actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { mapProjectWriteError } from '@/lib/supabase/project-errors'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { ProjectNameDialog } from './ProjectNameDialog'
import { ProjectTreePicker } from './ProjectTreePicker'

export function MoveTranscriptDialog({
  open,
  onOpenChange,
  transcript,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  transcript: TranscriptActionTarget | null
}) {
  const { tree, createProject, moveTranscript } = useProjectsData()
  const [selection, setSelection] = useState<string | null>(transcript?.project_id ?? null)
  const [createOpen, setCreateOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleMove = async () => {
    if (!transcript || selection === transcript.project_id) return
    setPending(true)
    setError(null)
    try {
      await moveTranscript(transcript.id, selection)
      onOpenChange(false)
    } catch (caught) {
      setError(mapProjectWriteError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
        <DialogContent className="overflow-hidden p-0">
          <div className="space-y-4 px-6 pb-5 pt-6">
            <div>
              <DialogTitle>Move “{transcript?.title ?? 'Transcript'}”</DialogTitle>
              <DialogDescription className="mt-1">Choose a new project or move it to Unfiled.</DialogDescription>
            </div>
            <ProjectTreePicker tree={tree} value={selection} onChange={setSelection} />
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setCreateOpen(true)}>
              New Project
            </Button>
            {error && <p role="alert" className="text-sm text-ember-red">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              disabled={pending || !transcript || selection === transcript.project_id}
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
