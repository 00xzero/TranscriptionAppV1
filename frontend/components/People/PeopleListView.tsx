'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Contact, Plus, Search } from 'lucide-react'
import { ErrorFallback } from '@/components/ErrorFallback'
import { DestructiveMenuItem, RowActionsMenu } from '@/components/RowActionsMenu'
import { ProjectList, ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { countLabel } from '@/components/Projects/format'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { LoadingStatus } from '@/components/ui/loading-status'
import { Toggle } from '@/components/ui/toggle'
import { toast } from '@/components/ui/toaster'
import type { DirectoryOrganisation, DirectoryPerson } from '@/contracts/db'
import { TEXT_LIMITS } from '@/contracts/limits'
import {
  filterDirectory,
  namesakesOf,
  NO_ORGANISATION,
  sortDirectory,
  updateDirectoryPerson,
} from '@/core/people/directory'
import { isConflict, isGone, mapPeopleWriteError } from '@/lib/people/errors'
import { refreshAfterConflict } from '@/lib/people/refreshAfterConflict'
import { usePeopleDirectoryContext } from '@/lib/people/PeopleDirectoryContext'
import { fromTranscriptId, personHref, personIdFromPathname } from '@/lib/people/routes'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { speakerInitials } from '@/lib/speakers/palette'
import { createPerson, deleteOrganisation, renameOrganisation } from '@/lib/supabase/queries'
import { cn } from '@/lib/utils'
import { BackToTranscript } from './BackToTranscript'
import { HiddenBadge } from './HiddenBadge'
import { PersonNameDialog } from './PersonNameDialog'
import { formatPeopleDate } from './format'

type Dialog = 'create' | 'rename-organisation' | 'delete-organisation' | null

/** An organisation filter chip, on or off. */
const CHIP = cn(
  'h-8 max-w-64 gap-1.5 rounded-full border border-border bg-control px-3 text-xs font-normal text-foreground/80',
  'hover:bg-control-hover hover:text-foreground',
  'data-[state=on]:border-trust-blue/50 data-[state=on]:bg-warm-highlight data-[state=on]:text-trust-blue',
  'dark:data-[state=on]:bg-night-border dark:data-[state=on]:text-paper'
)

/**
 * The People directory (spec §4): search, an organisation filter, recent or
 * A–Z order, and hidden people on request. Organisations are renamed and
 * deleted here, with one selected in the filter. A person opens as a dialog
 * over this list, which stays as it was underneath.
 */
export function PeopleListView() {
  const router = useRouter()
  const from = fromTranscriptId(useSearchParams().get('from'))
  const openPersonId = personIdFromPathname(usePathname())
  const { directory, openedFromListRef } = usePeopleDirectoryContext()
  const [query, setQuery] = useState('')
  // Selected organisation ids and NO_ORGANISATION; none selected is everyone.
  const [organisationFilter, setOrganisationFilter] = useState<string[]>([])
  const [byName, setByName] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)

  if (directory.loading) {
    return (
      <LoadingStatus message="Loading people…">
        <ProjectListSkeleton />
      </LoadingStatus>
    )
  }

  if (!directory.data) {
    return (
      <ErrorFallback
        title="We couldn't load your people"
        description="The People directory is temporarily unavailable. Try loading it again."
        primary={{ kind: 'button', label: 'Try again', onClick: () => void directory.reload() }}
        secondary={{ kind: 'link', label: 'Go home', href: '/' }}
      />
    )
  }

  const { people, organisations } = directory.data
  const hiddenCount = people.filter((person) => person.hidden).length
  // The toggle goes with the last hidden person, and so does its effect.
  const includeHidden = showHidden && hiddenCount > 0
  // An organisation deleted elsewhere drops out of the selection.
  const selected = organisationFilter.filter((value) =>
    value === NO_ORGANISATION || organisations.some((organisation) => organisation.id === value))
  const menuOrganisations = organisations.filter((organisation) => selected.includes(organisation.id))
  // Rename and delete apply to one organisation, so they are offered while exactly one is selected (spec §4).
  const menuOrganisation = menuOrganisations.length === 1 ? menuOrganisations[0] : undefined
  const shown = sortDirectory(filterDirectory(people, { query, organisations: selected, showHidden: includeHidden }), byName ? 'name' : 'recent')
  const hiddenMatches = includeHidden ? 0
    : filterDirectory(people, { query, organisations: selected, showHidden: true }).length - shown.length
  const filtered = query.trim() !== '' || selected.length > 0
  const closeDialog = (open: boolean) => { if (!open) setDialog(null) }

  return (
    <div className="space-y-6">
      <BackToTranscript from={from} />
      <section aria-labelledby="people-heading" className="space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h1 id="people-heading" className="font-serif text-2xl text-foreground">People</h1>
          {people.length > 0 && (
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setDialog('create')}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New person
            </Button>
          )}
        </div>

        {people.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-56 flex-1">
                <Input
                  aria-label="Search people"
                  placeholder="Search by name or organisation"
                  className="pl-8"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              </div>
              {/* Option toggles as in Find and Replace: the order switch (spec §4), and Show hidden once anyone is. */}
              <Toggle variant="outline" pressed={byName} onPressedChange={setByName}>Name A–Z</Toggle>
              {hiddenCount > 0 && (
                <Toggle variant="outline" pressed={includeHidden} onPressedChange={setShowHidden}>
                  Show hidden ({hiddenCount})
                </Toggle>
              )}
            </div>
            {organisations.length > 0 && (
              <OrganisationFilter
                people={includeHidden ? people : people.filter((person) => !person.hidden)}
                organisations={organisations}
                selected={selected}
                onChange={setOrganisationFilter}
                menuOrganisation={menuOrganisation}
                onRename={() => setDialog('rename-organisation')}
                onDelete={() => setDialog('delete-organisation')}
              />
            )}
          </div>
        )}
      </section>

      {people.length === 0 ? (
        <ProjectList>
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Contact className="h-10 w-10 text-muted" aria-hidden="true" />
            <h2 className="mt-4 font-serif text-2xl text-foreground">No people yet</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              There are two ways to add someone. In a transcript, click a speaker and identify them as a person.
              Or create a person here, then identify their voice in any transcript.
            </p>
            <Button className="mt-5 gap-1.5" size="sm" variant="primary" onClick={() => setDialog('create')}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New person
            </Button>
          </div>
        </ProjectList>
      ) : (
        <section aria-label="People">
          <ProjectList>
            {shown.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted">
                <p>
                  No people match.
                  {hiddenMatches > 0 && ` ${countLabel(hiddenMatches, 'hidden person matches', 'hidden people match')}; turn on Show hidden to see them.`}
                </p>
                {filtered && (
                  <Button size="sm" variant="secondary" className="mt-4" onClick={() => {
                    setQuery('')
                    setOrganisationFilter([])
                  }}>
                    Clear search and filter
                  </Button>
                )}
              </div>
            ) : (
              shown.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  href={personHref(person.id, from)}
                  open={person.id === openPersonId}
                  onOpen={() => { openedFromListRef.current = true }}
                />
              ))
            )}
          </ProjectList>
        </section>
      )}

      {dialog === 'create' && (
        <PersonNameDialog
          onOpenChange={closeDialog}
          title="New person"
          description="Add someone to your directory. Their organisation is set on their page."
          label="Name"
          maxLength={TEXT_LIMITS.speakerName}
          subject="person"
          submitLabel={(name) => namesakesOf(people, name).length > 0 ? `Create another “${name.trim()}”` : 'Create'}
          pendingLabel="Creating…"
          onSubmit={async (name) => {
            const person = await createPerson(name)
            directory.update((data) => updateDirectoryPerson(data, person))
            await directory.reload()
            openedFromListRef.current = true
            router.push(personHref(person.id, from))
          }}
        >
          {(name) => <Namesakes people={namesakesOf(people, name)} />}
        </PersonNameDialog>
      )}

      {dialog === 'rename-organisation' && menuOrganisation && (
        <PersonNameDialog
          onOpenChange={closeDialog}
          title="Rename organisation"
          description={`Everyone at ${menuOrganisation.name} shows the new name, in every transcript.`}
          label="Organisation name"
          initialName={menuOrganisation.name}
          maxLength={TEXT_LIMITS.organisationName}
          subject="organisation"
          submitLabel={() => 'Rename'}
          pendingLabel="Renaming…"
          onSubmit={async (name) => {
            try {
              const organisation = await renameOrganisation(menuOrganisation.id, menuOrganisation.name, name)
              directory.update((data) => ({
                people: data.people.map((person) => person.organisation_id === organisation.id
                  ? { ...person, organisation_name: organisation.name } : person),
                organisations: data.organisations.map((entry) => entry.id === organisation.id ? { ...entry, ...organisation } : entry),
              }))
            } catch (error) {
              if (!isConflict(error) && !isGone(error)) throw error
              await refreshAfterConflict(directory.reload, isGone(error) ? 'That organisation no longer exists.' : undefined)
              return
            }
            await directory.reload()
          }}
        />
      )}

      {menuOrganisation && (
        <ConfirmDialog
          open={dialog === 'delete-organisation'}
          onOpenChange={closeDialog}
          heading={`Delete ${menuOrganisation.name}?`}
          description={`${countLabel(menuOrganisation.person_count, 'person', 'people')} will have no organisation. No person is deleted.`}
          confirmLabel="Delete organisation"
          pendingLabel="Deleting…"
          onConfirm={async () => {
            try {
              await deleteOrganisation(menuOrganisation.id)
            } catch (error) {
              throw new Error(mapPeopleWriteError(error, 'organisation'))
            }
            setOrganisationFilter((values) => values.filter((value) => value !== menuOrganisation.id))
            toast({ title: `Deleted ${menuOrganisation.name}` })
            await directory.reload()
          }}
        />
      )}
    </div>
  )
}

/**
 * All, each organisation and No organisation (spec §4), as chips that turn on
 * and off, each with the number of people it would list. Any number can be on,
 * and the list shows people in any of them; All turns them all off. While one
 * organisation is on, its chip carries rename and delete.
 */
function OrganisationFilter({ people, organisations, selected, onChange, menuOrganisation, onRename, onDelete }: {
  people: readonly DirectoryPerson[]
  organisations: readonly DirectoryOrganisation[]
  selected: readonly string[]
  onChange: (selected: string[]) => void
  menuOrganisation: DirectoryOrganisation | undefined
  onRename: () => void
  onDelete: () => void
}) {
  const counts = new Map<string, number>()
  for (const person of people) {
    const key = person.organisation_id ?? NO_ORGANISATION
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const options = [
    ...organisations.map((entry) => ({ value: entry.id, label: entry.name, count: counts.get(entry.id) ?? 0 })),
    { value: NO_ORGANISATION, label: 'No organisation', count: counts.get(NO_ORGANISATION) ?? 0 },
  ]
  const toggle = (value: string, on: boolean) =>
    onChange(on ? [...selected, value] : selected.filter((entry) => entry !== value))

  return (
    <div role="group" aria-label="Organisation" className="flex flex-wrap items-center gap-2">
      <Toggle pressed={selected.length === 0} onPressedChange={() => onChange([])} className={CHIP}>
        All <span className="font-mono text-[11px] text-muted">{people.length}</span>
      </Toggle>
      {options.map((option) => (
        <span key={option.value} className="inline-flex items-center gap-0.5">
          <Toggle
            pressed={selected.includes(option.value)}
            onPressedChange={(on) => toggle(option.value, on)}
            className={CHIP}
          >
            <span className="truncate">{option.label}</span>
            <span className="font-mono text-[11px] text-muted">{option.count}</span>
          </Toggle>
          {menuOrganisation?.id === option.value && (
            <RowActionsMenu label={menuOrganisation.name}>
              <DropdownMenuItem onSelect={onRename}>Rename organisation</DropdownMenuItem>
              <DestructiveMenuItem onSelect={onDelete}>Delete organisation</DestructiveMenuItem>
            </RowActionsMenu>
          )}
        </span>
      ))}
    </div>
  )
}

function PersonRow({ person, href, open, onOpen }: {
  person: DirectoryPerson
  href: string
  /** This person's dialog is open over the list. */
  open: boolean
  onOpen: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onOpen}
      data-testid={`person-row-${person.id}`}
      className={cn('group grid min-h-18 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 p-4 transition-colors hover:bg-subtle sm:flex', open && 'bg-subtle')}
    >
      <Avatar color={person.preferred_color} className="row-span-2 h-10 min-w-10 self-start text-xs sm:self-center">
        {speakerInitials(person.name)}
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-ink transition-colors group-hover:text-trust-blue dark:text-paper">
          <span className="truncate">{person.name}</span>
          {person.hidden && <HiddenBadge />}
        </p>
        {person.organisation_name && <p className="truncate text-xs text-muted">{person.organisation_name}</p>}
      </div>
      <div className="col-start-2 min-w-0 font-mono text-[10px] text-muted sm:shrink-0 sm:text-right">
        <p>{countLabel(person.transcript_count, 'transcript', 'transcripts')}</p>
        <p>{person.last_seen_at ? `Last seen ${formatPeopleDate(person.last_seen_at)}` : 'Not in any transcript yet'}</p>
      </div>
    </Link>
  )
}

/** Existing people with the typed name, so a namesake is created knowingly (spec §4, §5). */
function Namesakes({ people }: { people: readonly DirectoryPerson[] }) {
  if (people.length === 0) return null
  return (
    <div className="rounded-sm border border-border bg-subtle px-3 py-2 text-xs text-muted">
      <p className="font-medium text-foreground">Already in your directory:</p>
      <ul className="mt-1 space-y-0.5">
        {people.map((person) => (
          <li key={person.id}>
            {[person.name, person.organisation_name, countLabel(person.transcript_count, 'transcript', 'transcripts')]
              .filter(Boolean).join(' · ')}
            {person.hidden && ' · hidden'}
          </li>
        ))}
      </ul>
    </div>
  )
}
