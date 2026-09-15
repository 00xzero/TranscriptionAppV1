'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { pathLabel } from '@/core/projects/tree'
import { mapProjectWriteError } from '@/lib/supabase/project-errors'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'

const dateFormat = new Intl.DateTimeFormat()

export function AddTranscriptsDialog({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const { transcripts, tree, addTranscripts } = useProjectsData()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Row labels are built once per data change, not on every keystroke or checkbox toggle.
  const rows = useMemo(() => {
    const locations = new Map<string, string>()
    return transcripts
      .filter((transcript) =>
        transcript.project_id !== projectId &&
        !(transcript.project_id && tree.byId.get(transcript.project_id)?.deleting_at)
      )
      .map((transcript) => {
        let location = ''
        if (transcript.project_id) {
          location = locations.get(transcript.project_id) ?? pathLabel(tree, transcript.project_id)
          locations.set(transcript.project_id, location)
        }
        const date = dateFormat.format(new Date(transcript.created_at))
        return {
          id: transcript.id,
          title: transcript.title || 'Untitled',
          detail: location ? `${date} · ${location}` : date,
        }
      })
  }, [projectId, transcripts, tree])

  const normalizedQuery = query.trim().toLowerCase()
  const candidates = normalizedQuery
    ? rows.filter((row) => row.title.toLowerCase().includes(normalizedQuery))
    : rows

  const handleAdd = async () => {
    setPending(true)
    setError(null)
    try {
      await addTranscripts([...selected], projectId)
      onClose()
    } catch (caught) {
      setError(mapProjectWriteError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="overflow-hidden p-0">
        <div className="space-y-4 px-6 pb-5 pt-6">
          <div>
            <DialogTitle>Add Transcripts</DialogTitle>
            <DialogDescription className="mt-1">Select transcripts to move into this project.</DialogDescription>
          </div>
          <Input aria-label="Search transcripts" placeholder="Search transcripts…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-sm border border-border bg-field/30">
            {candidates.map((row) => (
              <label key={row.id} className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-subtle">
                <input
                  type="checkbox"
                  className="mt-1 accent-trust-blue"
                  checked={selected.has(row.id)}
                  disabled={pending}
                  onChange={(event) => setSelected((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(row.id)
                    else next.delete(row.id)
                    return next
                  })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{row.title}</span>
                  <span className="block text-xs text-muted">{row.detail}</span>
                </span>
              </label>
            ))}
            {candidates.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No transcripts available.</p>}
          </div>
          {error && <p role="alert" className="text-sm text-ember-red">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" disabled={pending || selected.size === 0} onClick={() => void handleAdd()}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
