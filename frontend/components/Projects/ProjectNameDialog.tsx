'use client'

import { useState } from 'react'
import type { Project } from '@/contracts/db'
import { siblingNameTaken } from '@/core/projects/tree'
import { validateProjectName } from '@/core/projects/validate'
import { mapProjectWriteError } from '@/lib/supabase/project-errors'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

type ProjectNameDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'rename'
  parentId: string | null
  initialName?: string
  projectId?: string
  onSubmit: (name: string) => Promise<Project>
}

export function ProjectNameDialog({
  open,
  onOpenChange,
  mode,
  parentId,
  initialName = '',
  projectId,
  onSubmit,
}: ProjectNameDialogProps) {
  const { tree } = useProjectsData()
  const [name, setName] = useState(initialName)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName(initialName)
    setError(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) return
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const validated = validateProjectName(name)
    if (!validated.valid) {
      setError(validated.error)
      return
    }
    if (siblingNameTaken(tree, parentId, validated.name, projectId)) {
      setError('A project with that name already exists here.')
      return
    }

    setPending(true)
    setError(null)
    try {
      await onSubmit(validated.name)
      reset()
      onOpenChange(false)
    } catch (caught) {
      setError(mapProjectWriteError(caught))
    } finally {
      setPending(false)
    }
  }

  const isRename = mode === 'rename'
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-6 pb-5 pt-6">
            <div>
              <DialogTitle>{isRename ? 'Rename Project' : 'New Project'}</DialogTitle>
              <DialogDescription className="mt-1">
                {isRename ? 'Choose a new name for this project.' : 'Create a project in the selected location.'}
              </DialogDescription>
            </div>
            <Input
              autoFocus
              aria-label="Project name"
              value={name}
              maxLength={80}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
            {error && <p role="alert" className="text-sm text-ember-red">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? (isRename ? 'Renaming…' : 'Creating…') : (isRename ? 'Rename' : 'Create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
