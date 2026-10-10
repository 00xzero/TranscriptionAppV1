'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { countLabel, formatDuration } from '@/components/Projects/format'
import type { DirectoryPerson, MergePreview } from '@/contracts/db'
import { describeMergeVoice, matchesPersonSearch, sortDirectory } from '@/core/people/directory'
import { isConflict, isGone, mapPeopleWriteError } from '@/lib/people/errors'
import { speakerInitials } from '@/lib/speakers/palette'
import { fetchMergePreview } from '@/lib/supabase/queries'
import { formatPeopleDate } from './format'

// Keyed by the selection it answers, so a stale answer is never shown as current.
type PreviewState =
  | { status: 'idle' }
  | { status: 'ready'; ids: string; preview: MergePreview }
  | { status: 'error'; ids: string }

/**
 * Merge people (spec §4): pick the people to fold into the survivor, see every
 * transcript and local voice that will move, then confirm. The preview and
 * confirmation stand in for Undo, which merge does not have.
 */
export function MergePeopleDialog({ survivor, people, onOpenChange, onMerge }: {
  survivor: DirectoryPerson
  /** Everyone in the directory, hidden people included. */
  people: readonly DirectoryPerson[]
  onOpenChange: (open: boolean) => void
  /** Rejects to show an error in the dialog; resolves to close it. */
  onMerge: (personIds: string[], preview: MergePreview) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  // In the order they were picked: the first with an organisation donates it.
  const [selected, setSelected] = useState<string[]>([])
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewRevision, setPreviewRevision] = useState(0)
  const generationRef = useRef(0)

  const selectedKey = selected.join(',')
  useEffect(() => {
    const generation = ++generationRef.current
    if (!selectedKey) return
    const ids = selectedKey.split(',')
    fetchMergePreview(survivor.id, ids).then(
      (result) => { if (generationRef.current === generation) setPreview({ status: 'ready', ids: selectedKey, preview: result }) },
      (caught) => {
        console.error('[people] Failed to load merge preview:', caught)
        if (generationRef.current === generation) setPreview({ status: 'error', ids: selectedKey })
      })
  }, [survivor.id, selectedKey, previewRevision])

  // A preview for another selection is not this one's.
  const current = preview.status !== 'idle' && preview.ids === selectedKey ? preview : null
  const ready = current?.status === 'ready' ? current.preview : null

  const candidates = sortDirectory(people.filter((person) => person.id !== survivor.id), 'name')
    .filter((person) => selected.includes(person.id) || matchesPersonSearch(person, query))
  const kept = ready?.survivor
  const donor = kept?.organisation_id ? null : ready?.people.find((person) => person.organisation_id)
  const survivorTranscripts = new Set(ready?.survivor_transcript_ids ?? [])
  const outcome = `${kept?.name ?? survivor.name} keeps their name and colour` +
    (kept?.organisation_name ? ` and organisation, ${kept.organisation_name}` : '') +
    (donor ? `, and takes ${donor.organisation_name} from ${donor.name}` : '')
  // A name can end the sentence, and a name can end in a full stop.
  const outcomeSentence = outcome.endsWith('.') ? outcome : `${outcome}.`

  const toggle = (personId: string) => {
    setError(null)
    setPreview({ status: 'idle' })
    setSelected((ids) => ids.includes(personId) ? ids.filter((id) => id !== personId) : [...ids, personId])
  }

  const merge = async () => {
    if (!ready || pending) return
    setPending(true)
    setError(null)
    try {
      await onMerge(selected, ready)
      onOpenChange(false)
    } catch (caught) {
      if (isConflict(caught) || isGone(caught)) {
        setPreview({ status: 'idle' })
        setPreviewRevision((revision) => revision + 1)
      }
      setError(isConflict(caught)
        ? 'Merge details changed. Review the refreshed preview before confirming again.'
        : mapPeopleWriteError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!pending) onOpenChange(open) }}>
      <DialogContent className="top-[10vh] flex max-h-[80vh] flex-col overflow-hidden p-0">
        <div className="space-y-3 px-6 pb-4 pt-6">
          <div>
            <DialogTitle>Merge into {survivor.name}</DialogTitle>
            <DialogDescription className="mt-1">
              Choose the people who are really {survivor.name}. Everywhere they appear will show {survivor.name},
              and they are then deleted. This can&apos;t be undone.
            </DialogDescription>
          </div>
          <div className="relative">
            <Input
              autoFocus
              aria-label="Search people to merge"
              placeholder="Search people"
              className="pl-8"
              value={query}
              disabled={pending}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
          <div role="group" aria-label="People to merge" className="py-1">
            {candidates.length === 0 && <p className="px-6 py-3 text-sm text-muted">No one else matches.</p>}
            {candidates.map((person) => {
              const checked = selected.includes(person.id)
              return (
                <button
                  key={person.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={pending}
                  onClick={() => toggle(person.id)}
                  className="flex w-full items-center gap-3 px-6 py-2 text-left hover:bg-subtle"
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${checked ? 'border-trust-blue bg-trust-blue text-solid-foreground' : 'border-border'}`}>
                    {checked && <Check className="h-3 w-3" aria-hidden="true" />}
                  </span>
                  <Avatar size="sm" color={person.preferred_color}>{speakerInitials(person.name)}</Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {person.name}
                      {person.hidden && <span className="ml-2 font-mono text-[10px] text-muted">Hidden</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {[person.organisation_name, countLabel(person.transcript_count, 'transcript', 'transcripts')].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {selected.length > 0 && (
            <section aria-label="What will move" aria-busy={!ready} className="space-y-3 border-t border-border px-6 py-4 text-sm">
              <p className="text-muted">{outcomeSentence}</p>
              {current?.status === 'error' && <p role="alert" className="text-ember-red">Couldn&apos;t load what will move. Change the selection to try again.</p>}
              {!current && <p className="text-muted">Loading what will move…</p>}
              {ready?.people.map((entry) => {
                return (
                  <div key={entry.person_id}>
                    <p className="font-medium">
                      {entry.name} · {countLabel(entry.transcripts.length, 'transcript', 'transcripts')}
                    </p>
                    {entry.transcripts.length === 0 && <p className="text-muted">Not in any transcript.</p>}
                    <ul className="mt-1 space-y-1.5">
                      {entry.transcripts.map((transcript) => (
                        <li key={transcript.transcript_id}>
                          <span>{transcript.title || 'Untitled'}</span>
                          <span className="text-muted"> · {formatPeopleDate(transcript.created_at)}</span>
                          {survivorTranscripts.has(transcript.transcript_id) && (
                            <span className="text-muted"> · shows as one with {kept?.name}</span>
                          )}
                          <ul className="ml-4 text-xs text-muted">
                            {transcript.voices.map((voice) => (
                              <li key={voice.speaker_id}>
                                {describeMergeVoice(voice)} · {formatDuration(voice.talk_ms / 1000)}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </section>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
          {error && <p role="alert" className="mr-auto text-sm text-ember-red">{error}</p>}
          <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={!ready || pending} onClick={() => void merge()}>
            {pending ? 'Merging…' : `Merge ${countLabel(selected.length, 'person', 'people')}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
