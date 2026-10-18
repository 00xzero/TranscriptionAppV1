'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Building2, Eye, EyeOff, Merge, Palette, Pencil, Trash2, UserMinus } from 'lucide-react'
import { countLabel, formatDuration, transcriptProjectLabel } from '@/components/Projects/format'
import { ListRowSkeleton, ProjectList } from '@/components/Projects/ProjectList'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingStatus } from '@/components/ui/loading-status'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toaster'
import { UNDO_WINDOW_MS } from '@/lib/undo'
import { useDialogFocusRestore } from '@/components/ui/use-dialog-focus-restore'
import type { Organisation, Person, PersonAppearance, SegmentSpeakerChange } from '@/contracts/db'
import { TEXT_LIMITS } from '@/contracts/limits'
import { appearanceTotals, mergeDirectoryPeople, updateDirectoryPerson } from '@/core/people/directory'
import { reverseSpeakerChange } from '@/core/speakers/changes'
import { clearPersonDialogHandoff, isPersonDialogHandoff } from '@/lib/people/dialogHandoff'
import { isConflict, isGone, isNotReady, mapPeopleWriteError, NOT_READY_MESSAGE } from '@/lib/people/errors'
import { refreshAfterConflict } from '@/lib/people/refreshAfterConflict'
import { usePeopleDirectoryContext } from '@/lib/people/PeopleDirectoryContext'
import { fromTranscriptId, peopleHref } from '@/lib/people/routes'
import { usePersonAppearances } from '@/lib/people/usePeopleData'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { SPEAKER_COLOR_NAMES, type SpeakerColor } from '@/lib/speakers/palette'
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
import { cn } from '@/lib/utils'
import { BackToTranscript } from './BackToTranscript'
import { ColourPicker } from './ColourPicker'
import { AppearanceList } from './AppearanceList'
import { MergePeopleDialog } from './MergePeopleDialog'
import { OrganisationPicker } from './OrganisationPicker'
import { PersonHeading, PersonHeadingSkeleton } from './PersonHeading'
import { PersonNameDialog } from './PersonNameDialog'
import { formatPeopleDate } from './format'

type NestedDialog = 'rename' | 'merge' | 'delete' | null
type Picker = 'organisation' | 'colour' | null

const ICON = 'h-4 w-4'

/**
 * Closing returns to the list: back to the entry a list row added, or, after
 * a direct visit (a refresh, a shared link, the editor), to /people in place,
 * so Back never leaves the app.
 */
function useClosePerson() {
  const router = useRouter()
  const from = fromTranscriptId(useSearchParams().get('from'))
  const { openedFromListRef } = usePeopleDirectoryContext()
  return useCallback(() => {
    if (openedFromListRef.current) {
      openedFromListRef.current = false
      router.back()
    } else {
      router.replace(peopleHref('/people', from))
    }
  }, [router, from, openedFromListRef])
}

function PersonDialogFrame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { captureFocus, restoreFocus } = useDialogFocusRestore()
  // Opened from another dialog (a project's people): already open, so the
  // backdrop stays dark across the route change instead of flashing the page.
  const [handedOver] = useState(isPersonDialogHandoff)
  useEffect(() => { clearPersonDialogHandoff() }, [])
  const noEntrance = handedOver ? 'data-[state=open]:animate-none' : undefined
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        overlayClassName={noEntrance}
        focusSelfOnOpen
        // The URL opens this dialog, so it has no trigger for Radix to return
        // focus to: go back to what had it, such as the list row.
        onOpenAutoFocus={captureFocus}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocus()
        }}
        className={cn('top-[8vh] flex max-h-[84vh] w-[640px] max-w-[92vw] flex-col overflow-hidden p-0', noEntrance)}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** The dialog's message for a person it cannot show, with one way onward. */
function PersonMessage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="px-6 py-8 text-center">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription className="mt-2">{description}</DialogDescription>
      <div className="mt-5 flex justify-center gap-2">{children}</div>
    </div>
  )
}

/**
 * The person dialog's shape while the directory loads: heading, summary line
 * and transcript rows as placeholders, so the filled dialog lands in place.
 */
function PersonLoading() {
  return (
    <>
      <DialogTitle className="sr-only">Person</DialogTitle>
      <DialogDescription className="sr-only">This person&apos;s details are loading.</DialogDescription>
      <LoadingStatus message="Loading person…" className="flex min-h-0 flex-1 flex-col">
        <div aria-hidden="true" className="border-b border-border px-5 pb-4 pt-5">
          <PersonHeadingSkeleton />
          <div className="mt-3 h-4 w-64 animate-pulse rounded-sm bg-subtle" />
        </div>
        <div aria-hidden="true" className="px-5 pb-5 pt-4">
          <div className="mb-2 h-4" />
          <ProjectList><ListRowSkeleton /><ListRowSkeleton /></ProjectList>
        </div>
      </LoadingStatus>
    </>
  )
}

function PersonNotFound({ onClose }: { onClose: () => void }) {
  return (
    <PersonMessage
      title="Person not found"
      description="This person doesn't exist, was merged into someone else, or isn't available to your account."
    >
      <Button size="sm" variant="secondary" onClick={onClose}>View people</Button>
    </PersonMessage>
  )
}

/** /people/<id> for an id that is not a person's: the list, with this over it. */
export function PersonNotFoundDialog() {
  const close = useClosePerson()
  return (
    <PersonDialogFrame onClose={close}>
      <PersonNotFound onClose={close} />
    </PersonDialogFrame>
  )
}

/**
 * A person (spec §4), as a dialog over the People list: their name,
 * organisation and colour, the transcripts they appear in, and every change to
 * them. Remove from this transcript can be undone; merge and delete are
 * confirmed instead.
 */
export function PersonDialog({ personId }: { personId: string }) {
  const close = useClosePerson()
  const from = fromTranscriptId(useSearchParams().get('from'))
  const { directory } = usePeopleDirectoryContext()
  const appearances = usePersonAppearances(personId)
  const { tree } = useProjectsData()
  const [dialog, setDialog] = useState<NestedDialog>(null)
  const [picker, setPicker] = useState<Picker>(null)
  const [hiding, setHiding] = useState(false)

  // Opens at once, with the page, rather than after the directory lands: a
  // dialog that appeared only once the list behind it had shown read as a
  // second, separate step. Its own live region says it is loading; PeopleShell
  // puts the list, and its loading status, out of reach behind it.
  if (directory.loading) {
    return (
      <PersonDialogFrame onClose={close}>
        <PersonLoading />
      </PersonDialogFrame>
    )
  }

  if (!directory.data) {
    return (
      <PersonDialogFrame onClose={close}>
        <PersonMessage
          title="We couldn't load this person"
          description="The People directory is temporarily unavailable. Try loading it again."
        >
          <Button size="sm" variant="primary" onClick={() => void directory.reload()}>Try again</Button>
          <Button size="sm" variant="secondary" onClick={close}>View people</Button>
        </PersonMessage>
      </PersonDialogFrame>
    )
  }

  const person = directory.data.people.find((entry) => entry.id === personId)
  if (!person) {
    return (
      <PersonDialogFrame onClose={close}>
        <PersonNotFound onClose={close} />
      </PersonDialogFrame>
    )
  }

  const rows = appearances.data
  const hasAppearances = rows ? rows.length > 0 : person.transcript_count > 0
  const deleteBlocked = hasAppearances ? 'Remove or merge first' : rows === null ? 'Checking transcripts…' : undefined
  const reloadAll = async () => (await Promise.all([directory.reload(), appearances.reload()])).every(Boolean)
  const showPerson = (saved: Person, organisation?: Organisation | null) =>
    directory.update((data) => updateDirectoryPerson(data, saved, organisation))
  const closeDialog = (open: boolean) => { if (!open) setDialog(null) }
  const colourName = SPEAKER_COLOR_NAMES[person.preferred_color as SpeakerColor] ?? 'Custom colour'

  async function refreshAfterMerge() {
    if (await reloadAll()) return
    toast({
      title: "Merge saved — couldn't refresh",
      variant: 'error',
      action: { label: 'Retry', onClick: () => void refreshAfterMerge() },
    })
  }

  // A refused write means another tab changed this person first: reload and
  // say so. Any other failure is the dialog's or picker's to show.
  async function guarded<T>(write: () => Promise<T>, saved: (result: T) => void) {
    try {
      saved(await write())
    } catch (error) {
      if (!isConflict(error) && !isGone(error)) throw error
      await refreshAfterConflict(reloadAll, isGone(error) ? 'That person no longer exists.' : undefined)
      return
    }
    await reloadAll()
  }

  async function toggleHidden(hidden: boolean, name: string) {
    setHiding(true)
    try {
      showPerson(await setPersonHidden(personId, hidden))
      toast({ title: hidden ? `${name} is hidden from suggestions` : `${name} is back in suggestions` })
    } catch (error) {
      toast({ title: hidden ? `Couldn't hide ${name}` : `Couldn't unhide ${name}`, description: mapPeopleWriteError(error), variant: 'error' })
    } finally {
      setHiding(false)
      void directory.reload()
    }
  }

  // The row as the database last had it, in list_person_appearances' order, so
  // the dialog never shows a different state if the reload after a write fails.
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
      if (isNotReady(error)) {
        toast({ title: NOT_READY_MESSAGE, variant: 'error' })
        return
      }
      // Refused, or the person was merged away or deleted in another tab:
      // the reload shows what happened, and retrying could not succeed.
      if (isConflict(error) || isGone(error)) {
        await refreshAfterConflict(reloadAll, isGone(error) ? 'That person no longer exists.' : undefined)
        return
      }
      toast({ title: `Couldn't remove ${name} from “${title}”`, variant: 'error',
        action: { label: 'Retry', onClick: () => void removeFrom(appearance, name) } })
    }
    void reloadAll()
  }

  // Undo puts each segment back on the speaker it came from, refused if any
  // segment has moved since.
  async function undoRemove(appearance: PersonAppearance, changes: SegmentSpeakerChange[]) {
    try {
      await reassignSegments(appearance.transcript_id, changes.map(reverseSpeakerChange))
      showAppearance(appearance)
    } catch (error) {
      toast(isNotReady(error)
        ? { title: NOT_READY_MESSAGE, variant: 'error' }
        : isConflict(error)
        ? { title: "Can't undo — changed since", variant: 'error' }
        : { title: "Couldn't undo", variant: 'error',
          action: { label: 'Retry', onClick: () => void undoRemove(appearance, changes) } })
    }
    void reloadAll()
  }

  const totals = rows ? appearanceTotals(rows) : null
  const pickerOpen = (which: Exclude<Picker, null>) => (open: boolean) => setPicker(open ? which : null)

  return (
    <PersonDialogFrame onClose={close}>
      <div className="border-b border-border px-5 pb-4 pt-5">
        <BackToTranscript from={from} />
        <PersonHeading
          person={person}
          details={(
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: person.preferred_color }} />
                {colourName}
              </span>
            </>
          )}
          actions={(
            <div role="group" aria-label={`Actions for ${person.name}`} className="ml-auto flex items-center gap-0.5">
              <IconButton label="Rename person" icon={<Pencil className={ICON} aria-hidden="true" />}
                onClick={() => setDialog('rename')} />
              <Popover open={picker === 'organisation'} onOpenChange={pickerOpen('organisation')}>
                <PopoverTrigger asChild>
                  <IconButton label="Change organisation" icon={<Building2 className={ICON} aria-hidden="true" />}
                    active={picker === 'organisation'} />
                </PopoverTrigger>
                <PopoverContent align="end" className="z-[110] w-80 p-0">
                  <OrganisationPicker
                    organisations={directory.data.organisations}
                    currentId={person.organisation_id}
                    currentName={person.organisation_name}
                    onChoose={(choice) => guarded(() => setPersonOrganisation(personId, person.organisation_id, choice),
                      (result) => showPerson(result.person, result.organisation))
                      .then(() => setPicker(null))}
                  />
                </PopoverContent>
              </Popover>
              <Popover open={picker === 'colour'} onOpenChange={pickerOpen('colour')}>
                <PopoverTrigger asChild>
                  <IconButton label="Change colour" icon={<Palette className={ICON} aria-hidden="true" />}
                    active={picker === 'colour'} />
                </PopoverTrigger>
                <PopoverContent align="end" className="z-[110] w-64">
                  <ColourPicker
                    name={person.name}
                    current={person.preferred_color}
                    onChoose={(color) => guarded(() => setPersonColor(personId, person.preferred_color, color), showPerson)
                      .then(() => setPicker(null))}
                  />
                </PopoverContent>
              </Popover>
              <IconButton
                label={person.hidden ? 'Unhide' : 'Hide'}
                icon={person.hidden ? <Eye className={ICON} aria-hidden="true" /> : <EyeOff className={ICON} aria-hidden="true" />}
                aria-busy={hiding || undefined}
                onClick={() => { if (!hiding) void toggleHidden(!person.hidden, person.name) }}
              />
              <IconButton label="Merge people" icon={<Merge className={ICON} aria-hidden="true" />}
                onClick={() => setDialog('merge')} />
              <IconButton label="Delete person" icon={<Trash2 className={ICON} aria-hidden="true" />}
                unavailableReason={deleteBlocked} onClick={() => setDialog('delete')} />
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
              <DialogCloseButton />
            </div>
          )}
        />
        {/* Holds its line while the appearances load, so nothing below moves. */}
        <p className="mt-3 min-h-4 font-mono text-xs text-muted">
          {totals === null ? '' : totals.transcripts === 0 ? 'Not in any transcript yet'
            : `${countLabel(totals.transcripts, 'transcript', 'transcripts')} · ${formatDuration(totals.talkMs / 1000)} speaking`
              + (totals.lastSeen ? ` · last seen ${formatPeopleDate(totals.lastSeen)}` : '')}
        </p>
      </div>

      <section aria-labelledby="appearances-heading" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
        <h2 id="appearances-heading" className="mb-2 font-mono text-xs text-muted">Appearances</h2>
        <AppearanceList
          rows={rows}
          error={appearances.error}
          onRetry={() => void appearances.reload()}
          empty={<>{person.name} isn&apos;t in any transcript yet. Open a transcript and click a speaker to identify them.</>}
          projectLabel={(projectId) => transcriptProjectLabel(tree, projectId)}
          action={(appearance, title) => (
            <IconButton
              label="Remove from this transcript"
              ariaLabel={`Remove ${person.name} from “${title}”`}
              icon={<UserMinus className={ICON} aria-hidden="true" />}
              onClick={() => void removeFrom(appearance, person.name)}
            />
          )}
        />
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
          onSubmit={(name) => guarded(() => renamePerson(personId, person.name, name), showPerson)}
        />
      )}

      {dialog === 'merge' && (
        <MergePeopleDialog
          survivor={person}
          people={directory.data.people}
          onOpenChange={closeDialog}
          onMerge={async (personIds, preview) => {
            const saved = await mergePeople(personId, personIds, preview)
            directory.update((data) => mergeDirectoryPeople(data, saved, preview))
            // The preview lacks project ids and transcript speaking totals, so
            // these rows need a read before they can describe the merged person.
            appearances.invalidate()
            toast({ title: `Merged ${countLabel(personIds.length, 'person', 'people')} into ${person.name}` })
            await refreshAfterMerge()
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
          void directory.reload()
          close()
        }}
      />
    </PersonDialogFrame>
  )
}
