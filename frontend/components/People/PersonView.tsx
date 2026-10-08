'use client'

import { useId, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ErrorFallback } from '@/components/ErrorFallback'
import { ListSectionHeading, ProjectList, ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { countLabel, transcriptProjectLabel } from '@/components/Projects/format'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { LoadingStatus } from '@/components/ui/loading-status'
import { toast } from '@/components/ui/toaster'
import type { PersonAppearance, SegmentSpeakerChange } from '@/contracts/db'
import { TEXT_LIMITS } from '@/contracts/limits'
import { CONFLICT_TOAST, isConflict, isGone, mapPeopleWriteError } from '@/lib/people/errors'
import { fromTranscriptId, peopleHref } from '@/lib/people/routes'
import { usePeopleDirectory, usePersonAppearances } from '@/lib/people/usePeopleData'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { SPEAKER_COLOR_NAMES, speakerInitials, type SpeakerColor } from '@/lib/speakers/palette'
import {
  deletePerson,
  mergePeople,
  reassignSegments,
  removePersonFromTranscript,
  renamePerson,
  setPersonColor,
  setPersonHidden,
  setPersonOrganisation,
} from '@/lib/supabase/queries'
import { BackToTranscript } from './BackToTranscript'
import { ColourDialog } from './ColourDialog'
import { MergePeopleDialog } from './MergePeopleDialog'
import { OrganisationDialog } from './OrganisationDialog'
import { PersonNameDialog } from './PersonNameDialog'
import { formatPeopleDate } from './format'

type Dialog = 'rename' | 'organisation' | 'colour' | 'merge' | 'delete' | null

/** As long as the editor's Undo (spec §7). */
const UNDO_WINDOW_MS = 8000

/**
 * A person's page (spec §4): their name, organisation and colour, the
 * transcripts they appear in, and every change to them. Remove from this
 * transcript can be undone; merge and delete are confirmed instead.
 */
export function PersonView({ personId }: { personId: string }) {
  const router = useRouter()
  const from = fromTranscriptId(useSearchParams().get('from'))
  const directory = usePeopleDirectory()
  const appearances = usePersonAppearances(personId)
  const { tree } = useProjectsData()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [hiding, setHiding] = useState(false)
  const deleteHintId = useId()

  if (directory.loading) {
    return (
      <LoadingStatus message="Loading person…">
        <div className="mb-6 h-8 w-52 animate-pulse rounded-sm bg-subtle" />
        <ProjectListSkeleton />
      </LoadingStatus>
    )
  }

  if (!directory.data) {
    return (
      <ErrorFallback
        title="We couldn't load this person"
        description="The People directory is temporarily unavailable. Try loading it again."
        primary={{ kind: 'button', label: 'Try again', onClick: () => void directory.reload() }}
        secondary={{ kind: 'link', label: 'Back to people', href: peopleHref('/people', from) }}
      />
    )
  }

  const person = directory.data.people.find((entry) => entry.id === personId)
  if (!person) {
    return (
      <ErrorFallback
        eyebrow="404"
        title="Person not found"
        description="This person doesn't exist, was merged into someone else, or isn't available to your account."
        primary={{ kind: 'link', label: 'View people', href: peopleHref('/people', from) }}
      />
    )
  }

  const rows = appearances.data
  const hasAppearances = rows ? rows.length > 0 : person.transcript_count > 0
  const reloadAll = () => Promise.all([directory.reload(), appearances.reload()])
  const closeDialog = (open: boolean) => { if (!open) setDialog(null) }

  // A refused write means another tab changed this person first: reload and
  // say so. Any other failure is the dialog's to show.
  async function guarded(write: () => Promise<unknown>) {
    try {
      await write()
    } catch (error) {
      if (!isConflict(error)) throw error
      toast({ title: CONFLICT_TOAST, variant: 'error' })
    }
    await reloadAll()
  }

  async function toggleHidden(hidden: boolean, name: string) {
    setHiding(true)
    try {
      await setPersonHidden(personId, hidden)
      toast({ title: hidden ? `${name} is hidden from suggestions` : `${name} is back in suggestions` })
    } catch (error) {
      toast({ title: hidden ? `Couldn't hide ${name}` : `Couldn't unhide ${name}`, description: mapPeopleWriteError(error), variant: 'error' })
    } finally {
      setHiding(false)
      void directory.reload()
    }
  }

  // The row as the database last had it, in list_person_appearances' order, so
  // the page never shows a different state if the reload after a write fails.
  function showAppearance(appearance: PersonAppearance) {
    appearances.update((current) => current.some((row) => row.transcript_id === appearance.transcript_id)
      ? current
      : [...current, appearance].sort((a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        (a.transcript_id < b.transcript_id ? -1 : a.transcript_id > b.transcript_id ? 1 : 0)))
  }

  async function removeFrom(appearance: PersonAppearance, name: string) {
    const title = appearance.title || 'Untitled'
    // Hidden at once, and shown again if the write fails.
    appearances.update((current) => current.filter((row) => row.transcript_id !== appearance.transcript_id))
    try {
      const changes = await removePersonFromTranscript(personId, appearance.transcript_id)
      toast({
        title: `Removed ${name} from “${title}”`,
        durationMs: UNDO_WINDOW_MS,
        action: { label: 'Undo', onClick: () => void undoRemove(appearance, changes) },
      })
    } catch (error) {
      showAppearance(appearance)
      // Refused, or the person was merged away or deleted in another tab:
      // the reload shows what happened, and retrying could not succeed.
      toast(isConflict(error) || isGone(error)
        ? { title: CONFLICT_TOAST, variant: 'error' }
        : { title: `Couldn't remove ${name} from “${title}”`, variant: 'error',
          action: { label: 'Retry', onClick: () => void removeFrom(appearance, name) } })
    }
    void reloadAll()
  }

  // Undo puts each segment back on the speaker it came from, refused if any
  // segment has moved since.
  async function undoRemove(appearance: PersonAppearance, changes: SegmentSpeakerChange[]) {
    try {
      await reassignSegments(appearance.transcript_id, changes.map((change) => ({
        segment_id: change.segment_id, expected_speaker_id: change.speaker_id, speaker_id: change.expected_speaker_id,
      })))
      showAppearance(appearance)
    } catch (error) {
      toast(isConflict(error)
        ? { title: "Can't undo — changed since", variant: 'error' }
        : { title: "Couldn't undo", variant: 'error',
          action: { label: 'Retry', onClick: () => void undoRemove(appearance, changes) } })
    }
    void reloadAll()
  }

  return (
    <div className="space-y-6">
      <BackToTranscript from={from} />
      <section aria-labelledby="person-heading" className="rounded-sm border border-border bg-panel p-6">
        <div className="flex items-center gap-4">
          <Avatar color={person.preferred_color} className="h-14 min-w-14 text-base">
            {speakerInitials(person.name)}
          </Avatar>
          <div className="min-w-0">
            <h1 id="person-heading" className="truncate font-serif text-3xl text-foreground">{person.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span>{person.organisation_name ?? 'No organisation'}</span>
              <span aria-hidden="true">·</span>
              <span>{SPEAKER_COLOR_NAMES[person.preferred_color as SpeakerColor] ?? 'Custom colour'}</span>
              {person.hidden && (
                <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[9px]">Hidden</span>
              )}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDialog('rename')}>Rename person</Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog('organisation')}>Change organisation</Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog('colour')}>Change colour</Button>
          <Button size="sm" variant="secondary" disabled={hiding}
            onClick={() => void toggleHidden(!person.hidden, person.name)}>
            {person.hidden ? 'Unhide' : 'Hide'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog('merge')}>Merge people</Button>
          <Button size="sm" variant="secondary" disabled={hasAppearances || rows === null}
            aria-describedby={hasAppearances ? deleteHintId : undefined}
            onClick={() => setDialog('delete')}>
            Delete person
          </Button>
          {hasAppearances && <span id={deleteHintId} className="text-xs text-muted">Remove or merge first</span>}
        </div>
      </section>

      <section aria-labelledby="appearances-heading">
        <ListSectionHeading
          id="appearances-heading"
          title="Appearances"
          meta={rows ? countLabel(rows.length, 'transcript', 'transcripts') : ''}
        />
        {rows === null ? (
          appearances.error ? (
            <ProjectList>
              <p className="px-6 py-6 text-sm text-muted">
                Couldn&apos;t load the transcripts.{' '}
                <button type="button" className="text-trust-blue hover:underline" onClick={() => void appearances.reload()}>
                  Try again
                </button>
              </p>
            </ProjectList>
          ) : (
            <ProjectListSkeleton />
          )
        ) : rows.length === 0 ? (
          <ProjectList>
            <p className="px-6 py-6 text-sm text-muted">
              {person.name} isn&apos;t in any transcript yet. Open a transcript and click a speaker to identify them.
            </p>
          </ProjectList>
        ) : (
          <ProjectList>
            {rows.map((appearance) => {
              const title = appearance.title || 'Untitled'
              const project = transcriptProjectLabel(tree, appearance.project_id)
              return (
                <div key={appearance.transcript_id} data-testid={`appearance-${appearance.transcript_id}`}
                  className="group flex min-h-16 items-center gap-4 p-4 transition-colors hover:bg-subtle">
                  <Link href={`/editor/${appearance.transcript_id}`} title={`Open ${title}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink transition-colors group-hover:text-trust-blue dark:text-paper">
                      {title}
                    </p>
                    <p className="truncate font-mono text-[10px] text-ink/50 dark:text-paper/50">
                      {project && <span title={project.full}>{project.label} · </span>}
                      {formatPeopleDate(appearance.created_at)} · {countLabel(appearance.segment_count, 'segment', 'segments')}
                    </p>
                  </Link>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${person.name} from “${title}”`}
                    onClick={() => void removeFrom(appearance, person.name)}>
                    Remove from this transcript
                  </Button>
                </div>
              )
            })}
          </ProjectList>
        )}
      </section>

      {dialog === 'rename' && (
        <PersonNameDialog
          onOpenChange={closeDialog}
          title="Rename person"
          description={`Every transcript that shows ${person.name} will show the new name. Past exports stay as they are.`}
          label="Name"
          initialName={person.name}
          maxLength={TEXT_LIMITS.speakerName}
          subject="person"
          submitLabel={() => 'Rename'}
          pendingLabel="Renaming…"
          onSubmit={(name) => guarded(() => renamePerson(personId, person.name, name))}
        />
      )}

      {dialog === 'organisation' && (
        <OrganisationDialog
          organisations={directory.data.organisations}
          currentId={person.organisation_id}
          currentName={person.organisation_name}
          onOpenChange={closeDialog}
          onChoose={(choice) => guarded(() => setPersonOrganisation(personId, person.organisation_id, choice))}
        />
      )}

      {dialog === 'colour' && (
        <ColourDialog
          name={person.name}
          current={person.preferred_color}
          onOpenChange={closeDialog}
          onChoose={(color) => guarded(() => setPersonColor(personId, person.preferred_color, color))}
        />
      )}

      {dialog === 'merge' && (
        <MergePeopleDialog
          survivor={person}
          people={directory.data.people}
          onOpenChange={closeDialog}
          onMerge={async (personIds) => {
            await mergePeople(personId, personIds)
            toast({ title: `Merged ${countLabel(personIds.length, 'person', 'people')} into ${person.name}` })
            await reloadAll()
          }}
        />
      )}

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={closeDialog}
        heading={`Delete ${person.name}?`}
        description={`${person.name} isn't in any transcript. This can't be undone.`}
        confirmLabel="Delete person"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          try {
            await deletePerson(personId)
          } catch (error) {
            if (isConflict(error)) void reloadAll()
            throw new Error(isConflict(error) ? `${person.name} now appears in a transcript. Remove or merge first.`
              : mapPeopleWriteError(error))
          }
          toast({ title: `Deleted ${person.name}` })
          router.push(peopleHref('/people', from))
        }}
      />
    </div>
  )
}
