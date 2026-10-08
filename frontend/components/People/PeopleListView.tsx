'use client'

import { useId, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Contact, Plus, Search } from 'lucide-react'
import { ErrorFallback } from '@/components/ErrorFallback'
import { ListSectionHeading, ProjectList, ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { countLabel } from '@/components/Projects/format'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingStatus } from '@/components/ui/loading-status'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toaster'
import type { DirectoryPerson } from '@/contracts/db'
import { TEXT_LIMITS } from '@/contracts/limits'
import {
  ALL_ORGANISATIONS,
  filterDirectory,
  namesakesOf,
  NO_ORGANISATION,
  sortDirectory,
} from '@/core/people/directory'
import { CONFLICT_TOAST, isConflict, mapPeopleWriteError } from '@/lib/people/errors'
import { fromTranscriptId, personHref } from '@/lib/people/routes'
import { usePeopleDirectory } from '@/lib/people/usePeopleData'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { speakerInitials } from '@/lib/speakers/palette'
import { createPerson, deleteOrganisation, renameOrganisation } from '@/lib/supabase/queries'
import { BackToTranscript } from './BackToTranscript'
import { PersonNameDialog } from './PersonNameDialog'
import { formatPeopleDate } from './format'

type Dialog = 'create' | 'rename-organisation' | 'delete-organisation' | null

/**
 * The People directory (spec §4): search, an organisation filter, recent or
 * A–Z order, and hidden people on request. Organisations are renamed and
 * deleted here, with one selected in the filter.
 */
export function PeopleListView() {
  const router = useRouter()
  const from = fromTranscriptId(useSearchParams().get('from'))
  const directory = usePeopleDirectory()
  const [query, setQuery] = useState('')
  const [organisationFilter, setOrganisationFilter] = useState<string>(ALL_ORGANISATIONS)
  const [byName, setByName] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const id = useId()

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
  const selectedOrganisation = organisations.find((organisation) => organisation.id === organisationFilter)
  // An organisation deleted elsewhere falls back to everyone.
  const organisation = selectedOrganisation || organisationFilter === NO_ORGANISATION
    ? organisationFilter : ALL_ORGANISATIONS
  const shown = sortDirectory(filterDirectory(people, { query, organisation, showHidden }), byName ? 'name' : 'recent')
  const hiddenMatches = showHidden ? 0
    : filterDirectory(people, { query, organisation, showHidden: true }).length - shown.length
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
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
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
            <Select value={organisation} onValueChange={setOrganisationFilter}>
              <SelectTrigger aria-label="Organisation" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ORGANISATIONS}>All organisations</SelectItem>
                {organisations.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name} ({entry.person_count})
                  </SelectItem>
                ))}
                <SelectItem value={NO_ORGANISATION}>No organisation</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch id={`${id}-order`} checked={byName} onCheckedChange={setByName} />
              <Label htmlFor={`${id}-order`} className="text-sm">Name A–Z</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id={`${id}-hidden`} checked={showHidden} onCheckedChange={setShowHidden} />
              <Label htmlFor={`${id}-hidden`} className="text-sm">Show hidden</Label>
            </div>
          </div>
        )}

        {selectedOrganisation && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDialog('rename-organisation')}>
              Rename organisation
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog('delete-organisation')}>
              Delete organisation
            </Button>
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
        <section aria-labelledby="people-list-heading">
          <ListSectionHeading
            id="people-list-heading"
            title={selectedOrganisation?.name ?? (organisation === NO_ORGANISATION ? 'No organisation' : 'Everyone')}
            meta={countLabel(shown.length, 'person', 'people')}
          />
          <ProjectList>
            {shown.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted">
                No people match.
                {hiddenMatches > 0 && ` ${countLabel(hiddenMatches, 'hidden person matches', 'hidden people match')}; turn on Show hidden to see them.`}
              </p>
            ) : (
              shown.map((person) => <PersonRow key={person.id} person={person} href={personHref(person.id, from)} />)
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
            router.push(personHref(person.id, from))
          }}
        >
          {(name) => <Namesakes people={namesakesOf(people, name)} />}
        </PersonNameDialog>
      )}

      {dialog === 'rename-organisation' && selectedOrganisation && (
        <PersonNameDialog
          onOpenChange={closeDialog}
          title="Rename organisation"
          description={`Everyone at ${selectedOrganisation.name} shows the new name, in every transcript.`}
          label="Organisation name"
          initialName={selectedOrganisation.name}
          maxLength={TEXT_LIMITS.organisationName}
          subject="organisation"
          submitLabel={() => 'Rename'}
          pendingLabel="Renaming…"
          onSubmit={async (name) => {
            try {
              await renameOrganisation(selectedOrganisation.id, selectedOrganisation.name, name)
            } catch (error) {
              if (!isConflict(error)) throw error
              toast({ title: CONFLICT_TOAST, variant: 'error' })
            }
            await directory.reload()
          }}
        />
      )}

      {selectedOrganisation && (
        <ConfirmDialog
          open={dialog === 'delete-organisation'}
          onOpenChange={closeDialog}
          heading={`Delete ${selectedOrganisation.name}?`}
          description={`${countLabel(selectedOrganisation.person_count, 'person', 'people')} will have no organisation. No person is deleted.`}
          confirmLabel="Delete organisation"
          pendingLabel="Deleting…"
          onConfirm={async () => {
            try {
              await deleteOrganisation(selectedOrganisation.id)
            } catch (error) {
              throw new Error(mapPeopleWriteError(error, 'organisation'))
            }
            setOrganisationFilter(ALL_ORGANISATIONS)
            toast({ title: `Deleted ${selectedOrganisation.name}` })
            await directory.reload()
          }}
        />
      )}
    </div>
  )
}

function PersonRow({ person, href }: { person: DirectoryPerson; href: string }) {
  return (
    <Link
      href={href}
      data-testid={`person-row-${person.id}`}
      className="group flex min-h-18 items-center gap-4 p-4 transition-colors hover:bg-subtle"
    >
      <Avatar color={person.preferred_color} className="h-10 min-w-10 text-xs">
        {speakerInitials(person.name)}
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-ink transition-colors group-hover:text-trust-blue dark:text-paper">
          <span className="truncate">{person.name}</span>
          {person.hidden && (
            <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted">Hidden</span>
          )}
        </p>
        {person.organisation_name && <p className="truncate text-xs text-muted">{person.organisation_name}</p>}
      </div>
      <div className="shrink-0 text-right font-mono text-[10px] text-ink/60 dark:text-paper/60">
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
