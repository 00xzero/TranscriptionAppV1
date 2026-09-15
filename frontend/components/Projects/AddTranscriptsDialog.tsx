'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { pathLabel } from '@/core/projects/tree'
import { mapProjectWriteError } from '@/lib/supabase/project-errors'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'

export function AddTranscriptsDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}) {
  const { transcripts, tree, addTranscripts } = useProjectsData()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return transcripts.filter((transcript) => {
      if (transcript.project_id === projectId) return false
      if (transcript.project_id && tree.byId.get(transcript.project_id)?.deleting_at) return false
      const title = transcript.title || 'Untitled'
      return !normalized || title.toLowerCase().includes(normalized)
    })
  }, [projectId, query, transcripts, tree])

  const handleAdd = async () => {
    if (selected.size === 0) return
    setPending(true)
    setError(null)
    try {
      await addTranscripts([...selected], projectId)
      onOpenChange(false)
    } catch (caught) {
      setError(mapProjectWriteError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="overflow-hidden p-0">
        <div className="space-y-4 px-6 pb-5 pt-6">
          <div>
            <DialogTitle>Add Transcripts</DialogTitle>
            <DialogDescription className="mt-1">Select transcripts to move into this project.</DialogDescription>
          </div>
          <Input aria-label="Search transcripts" placeholder="Search transcripts…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-sm border border-border bg-field/30">
            {candidates.map((transcript) => {
              const title = transcript.title || 'Untitled'
              const location = transcript.project_id ? pathLabel(tree, transcript.project_id) : ''
              return (
                <label key={transcript.id} className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-subtle">
                  <input
                    type="checkbox"
                    className="mt-1 accent-trust-blue"
                    checked={selected.has(transcript.id)}
                    disabled={pending}
                    onChange={(event) => setSelected((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(transcript.id)
                      else next.delete(transcript.id)
                      return next
                    })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{title}</span>
                    <span className="block text-xs text-muted">
                      {new Date(transcript.created_at).toLocaleDateString()}{location ? ` · ${location}` : ''}
                    </span>
                  </span>
                </label>
              )
            })}
            {candidates.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No transcripts available.</p>}
          </div>
          {error && <p role="alert" className="text-sm text-ember-red">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="primary" disabled={pending || selected.size === 0} onClick={() => void handleAdd()}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
