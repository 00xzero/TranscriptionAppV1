'use client'

import { useId, useState } from 'react'
import { Building2, Plus, X } from 'lucide-react'
import { CharacterCount } from '@/components/ui/character-count'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { DirectoryOrganisation } from '@/contracts/db'
import { TEXT_LIMITS } from '@/contracts/limits'
import { exactOrganisation, matchOrganisations } from '@/core/people/directory'
import { mapPeopleWriteError } from '@/lib/people/errors'
import { nameLength } from './format'

export type OrganisationChoice = { organisationId: string } | { newOrganisationName: string } | null

type Option = { key: string; label: string; choice: OrganisationChoice; icon: 'organisation' | 'create' | 'clear' }

const LIMIT = TEXT_LIMITS.organisationName

/**
 * Change organisation (spec §4): type-ahead over the user's organisations,
 * creating one only when nothing matches the name exactly (ignoring case).
 * Choosing a row applies it; No organisation clears it.
 */
export function OrganisationDialog({ organisations, currentId, currentName, onOpenChange, onChoose }: {
  organisations: readonly DirectoryOrganisation[]
  currentId: string | null
  currentName: string | null
  onOpenChange: (open: boolean) => void
  /** Rejects to show an error in the dialog; resolves to close it. */
  onChoose: (choice: OrganisationChoice) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const listId = `${id}-list`

  const name = query.trim()
  const tooLong = nameLength(name) > LIMIT
  const options: Option[] = [
    ...(currentId ? [{ key: 'clear', label: 'No organisation', choice: null, icon: 'clear' as const }] : []),
    ...matchOrganisations(organisations, query)
      .filter((organisation) => organisation.id !== currentId)
      .map((organisation) => ({
        key: organisation.id, label: organisation.name,
        choice: { organisationId: organisation.id }, icon: 'organisation' as const,
      })),
    ...(name && !tooLong && !exactOrganisation(organisations, name)
      ? [{ key: 'create', label: `Create “${name}”`, choice: { newOrganisationName: name }, icon: 'create' as const }]
      : []),
  ]
  const highlighted = options[Math.min(active, options.length - 1)]

  const choose = async (option: Option) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onChoose(option.choice)
      onOpenChange(false)
    } catch (caught) {
      setError(mapPeopleWriteError(caught, 'organisation'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!pending) onOpenChange(open) }}>
      <DialogContent className="overflow-hidden p-0">
        <div className="space-y-3 px-6 pb-4 pt-6">
          <div>
            <DialogTitle>Change organisation</DialogTitle>
            <DialogDescription className="mt-1">
              {currentName ? `Currently ${currentName}. ` : ''}Choose an organisation, or type a new one.
            </DialogDescription>
          </div>
          <Input
            autoFocus
            role="combobox"
            aria-label="Organisation"
            aria-expanded
            aria-controls={listId}
            aria-describedby={`${id}-count`}
            aria-invalid={tooLong || undefined}
            aria-activedescendant={highlighted ? `${listId}-${highlighted.key}` : undefined}
            value={query}
            disabled={pending}
            placeholder="Search or add an organisation"
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, options.length - 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
              else if (event.key === 'Enter' && highlighted) { event.preventDefault(); void choose(highlighted) }
            }}
          />
          <div className="-mt-1 flex items-start justify-between gap-3">
            {tooLong
              ? <p role="alert" className="text-sm text-ember-red">Organisation names must be {LIMIT} characters or fewer.</p>
              : error ? <p role="alert" className="text-sm text-ember-red">{error}</p> : <span />}
            <CharacterCount id={`${id}-count`} length={nameLength(query)} max={LIMIT} />
          </div>
        </div>
        <div id={listId} role="listbox" aria-label="Organisations" className="max-h-64 overflow-y-auto border-t border-border py-1">
          {options.length === 0 && <p className="px-6 py-3 text-sm text-muted">No other organisations yet. Type a name to add one.</p>}
          {options.map((option) => (
            <button
              key={option.key}
              id={`${listId}-${option.key}`}
              type="button"
              role="option"
              aria-selected={option === highlighted}
              disabled={pending}
              onMouseEnter={() => setActive(options.indexOf(option))}
              onClick={() => void choose(option)}
              className={`flex w-full items-center gap-2.5 px-6 py-2 text-left text-sm ${option === highlighted ? 'bg-subtle' : ''}`}
            >
              {option.icon === 'create' ? <Plus className="h-4 w-4 text-muted" aria-hidden="true" />
                : option.icon === 'clear' ? <X className="h-4 w-4 text-muted" aria-hidden="true" />
                : <Building2 className="h-4 w-4 text-muted" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
