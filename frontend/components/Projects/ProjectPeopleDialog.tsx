'use client'

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { AppearanceList } from '@/components/People/AppearanceList'
import { PersonHeading } from '@/components/People/PersonHeading'
import { PersonRow } from '@/components/People/PersonRow'
import { formatPeopleDate } from '@/components/People/format'
import { Avatar } from '@/components/ui/avatar'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Project, ProjectPeople, ProjectPerson, ProjectVoices } from '@/contracts/db'
import { appearanceTotals, matchesPersonSearch } from '@/core/people/directory'
import { activeBranchIds, type ProjectTree } from '@/core/projects/tree'
import { markPersonDialogHandoff } from '@/lib/people/dialogHandoff'
import { personHref } from '@/lib/people/routes'
import { usePersonAppearances } from '@/lib/people/usePeopleData'
import { projectSpeakerTotal, useProjectPeople } from '@/lib/projects/useProjectPeople'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { voiceDisplay } from '@/lib/speakers/display'
import { cn } from '@/lib/utils'
import { countLabel, formatDuration, transcriptProjectLabel } from './format'
import { ListRowSkeleton, ProjectList } from './ProjectList'

/** Past this many people the list gets a filter box. */
const FILTER_FROM = 9

/** The chevron a row shows while hovered or focused, saying it opens something. */
function RowChevron() {
  return (
    <ChevronRight
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
    />
  )
}

/**
 * Each screen's close button, in the same corner of both, so it slides away
 * with one screen as an identical one slides in with the other and lands where
 * the first stood. The hidden screen is inert and aria-hidden, so only one is
 * ever reachable.
 * Each header leaves room for it.
 */
function ScreenClose() {
  return <DialogCloseButton className="absolute right-4 top-4 z-10" />
}

function isTextEntry(target: EventTarget): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/**
 * Who speaks in a project and every project nested in it: the people, most
 * involved first, then the unnamed voices folded away. Choosing someone slides
 * to the transcripts they are in. A lighter People page for one folder, built
 * from the People page's own rows; nothing here edits.
 *
 * Mount it only while open, keyed by project id, so each opening loads afresh
 * and starts on the list. `onLoaded` hears the speaker total of every
 * successful load, for the header to check its own count against.
 */
export function ProjectPeopleDialog({ project, tree, branchTranscripts, returnFocusRef, onClose, onLoaded }: {
  project: Project
  tree: ProjectTree
  /** The transcripts in the project's active branch, for the counts line. */
  branchTranscripts: readonly { project_id: string | null }[]
  /** The header button: focus goes back there when the dialog closes. */
  returnFocusRef: RefObject<HTMLElement | null>
  onClose: () => void
  onLoaded: (speakerTotal: number) => void
}) {
  const people = useProjectPeople(project.id)
  // The person stays chosen after Back, so their screen is still there, full,
  // as it slides away; `showingPerson` is what moves the track.
  const [personId, setPersonId] = useState<string | null>(null)
  const [onPerson, setOnPerson] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const headingId = useId()

  // Every successful load is a new object, so this hears each one once.
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => { onLoadedRef.current = onLoaded })
  useEffect(() => {
    if (people.data) onLoadedRef.current(projectSpeakerTotal(people.data))
  }, [people.data])

  const person = personId ? people.data?.people.find((entry) => entry.id === personId) ?? null : null
  const showingPerson = onPerson && person !== null

  useEffect(() => {
    if (showingPerson) backRef.current?.focus({ preventScroll: true })
  }, [showingPerson, personId])

  const openPerson = (id: string) => {
    setPersonId(id)
    setOnPerson(true)
  }
  const back = () => {
    const from = personId
    setOnPerson(false)
    // The list stayed mounted, scrolled where it was; put focus back on the row.
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-testid="person-row-${from}"]`)?.focus({ preventScroll: true })
    })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' && showingPerson && !isTextEntry(event.target)) {
      event.preventDefault()
      back()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        focusSelfOnOpen
        onOpenAutoFocus={(event) => {
          if (filterRef.current) {
            event.preventDefault()
            filterRef.current.focus()
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus({ preventScroll: true })
        }}
        onKeyDown={onKeyDown}
        // On the person screen the dialog is named and described by that person.
        {...(showingPerson ? { 'aria-labelledby': headingId, 'aria-describedby': `${headingId}-summary` } : {})}
        className="top-[8vh] flex h-[min(640px,84vh)] w-[640px] max-w-[92vw] flex-col overflow-hidden p-0"
      >
        {/* Both screens stay fully drawn and move as one strip, so the one coming
            back is seen arriving rather than fading up from nothing. Under
            reduced motion they swap with a short fade instead. */}
        <div
          className={cn(
            'flex h-full w-[200%] transition-transform duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
            showingPerson && '-translate-x-1/2'
          )}
        >
          <div
            ref={listRef}
            inert={showingPerson}
            aria-hidden={showingPerson || undefined}
            className={cn('relative flex h-full w-1/2 min-w-0 flex-col motion-reduce:transition-opacity motion-reduce:duration-150', showingPerson && 'motion-reduce:opacity-0')}
          >
            <ScreenClose />
            <PeopleScreen
              project={project}
              tree={tree}
              people={people.data}
              error={people.error}
              onRetry={() => void people.reload()}
              branchTranscripts={branchTranscripts}
              filterRef={filterRef}
              onOpenPerson={openPerson}
            />
          </div>
          <div
            inert={!showingPerson}
            aria-hidden={!showingPerson || undefined}
            className={cn('relative flex h-full w-1/2 min-w-0 flex-col motion-reduce:transition-opacity motion-reduce:duration-150', !showingPerson && 'motion-reduce:opacity-0')}
          >
            {person && <ScreenClose />}
            {person && (
              <PersonScreen
                key={person.id}
                project={project}
                tree={tree}
                person={person}
                headingId={headingId}
                backRef={backRef}
                onBack={back}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PeopleScreen({ project, tree, people, error, onRetry, branchTranscripts, filterRef, onOpenPerson }: {
  project: Project
  tree: ProjectTree
  people: ProjectPeople | null
  error: unknown
  onRetry: () => void
  branchTranscripts: readonly { project_id: string | null }[]
  filterRef: RefObject<HTMLInputElement | null>
  onOpenPerson: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const nested = branchTranscripts.filter((transcript) => transcript.project_id !== project.id).length
  const shown = people?.people.filter((person) => matchesPersonSearch(person, query)) ?? []

  return (
    <>
      <div className="border-b border-border px-5 pb-4 pt-5">
        <div className="flex items-start gap-3 pr-10">
          <div className="min-w-0 flex-1">
            <DialogTitle className="break-words text-2xl leading-tight">People in {project.name}</DialogTitle>
            {/* Holds its line while the people load, so nothing below moves. */}
            <DialogDescription className="mt-1 min-h-4 font-mono text-xs text-muted">
              {people && (
                `${countLabel(people.people.length, 'person', 'people')} · `
                + countLabel(branchTranscripts.length, 'transcript', 'transcripts')
                + (nested > 0 ? `, ${nested} of them in sub-projects` : '')
              )}
            </DialogDescription>
          </div>
        </div>
        {people && people.people.length >= FILTER_FROM && (
          <div className="relative mt-3">
            <Input
              ref={filterRef}
              aria-label="Filter people"
              placeholder="Filter by name or organisation"
              className="pl-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
        {people === null ? (
          <ProjectList>
            {error ? (
              <p className="px-4 py-5 text-sm text-muted">
                Couldn&apos;t load the people.{' '}
                <button type="button" className="text-trust-blue hover:underline" onClick={onRetry}>
                  Try again
                </button>
              </p>
            ) : (
              <><ListRowSkeleton /><ListRowSkeleton /><ListRowSkeleton /></>
            )}
          </ProjectList>
        ) : (
          <>
            {people.people.length > 0 && (
              <ProjectList>
                {shown.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-muted">No one here matches “{query.trim()}”.</p>
                ) : shown.map((person) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    onClick={() => onOpenPerson(person.id)}
                    stats={(
                      <>
                        <span className="block">{countLabel(person.transcript_count, 'transcript', 'transcripts')}</span>
                        <span className="block">{formatDuration(person.talk_ms / 1000)} speaking</span>
                      </>
                    )}
                  />
                ))}
              </ProjectList>
            )}
            {people.voices.length > 0 && <UnnamedVoices project={project} tree={tree} voices={people.voices} />}
          </>
        )}
      </div>
    </>
  )
}

/** The voices nobody has named, folded away until wanted; each row opens its transcript. */
function UnnamedVoices({ project, tree, voices }: {
  project: Project
  tree: ProjectTree
  voices: readonly ProjectVoices[]
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rows = useMemo(() => voices.map((transcript) => ({
    transcript,
    voices: transcript.voice_ids.map((id) => voiceDisplay(transcript.peers, id)),
  })), [voices])
  const total = rows.reduce((sum, row) => sum + row.voices.length, 0)

  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex w-full items-center gap-3 rounded-sm border border-dashed border-border px-4 py-3 text-left transition-colors hover:bg-subtle',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/60',
          open && 'rounded-b-none border-solid'
        )}
      >
        <span className="flex">
          {rows.flatMap((row) => row.voices).slice(0, 3).map((voice, index) => (
            <Avatar key={index} size="sm" color={voice.color} className={cn('ring-2 ring-panel', index > 0 && '-ml-1')}>
              {voice.avatarText}
            </Avatar>
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            {countLabel(total, 'unnamed voice', 'unnamed voices')}
          </span>
          <span className="block font-mono text-[10px] text-muted">
            in {countLabel(rows.length, 'transcript', 'transcripts')}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={panelId} className="divide-y divide-border rounded-b-sm border border-t-0 border-border bg-panel">
          {rows.map(({ transcript, voices: shown }) => {
            const title = transcript.title || 'Untitled'
            const place = transcriptProjectLabel(tree, transcript.project_id, project.id)
            return (
              <Link
                key={transcript.transcript_id}
                href={`/editor/${transcript.transcript_id}`}
                title={`Open ${title}`}
                className="group flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60"
              >
                <span className="flex">
                  {shown.map((voice, index) => (
                    <Avatar key={index} size="sm" color={voice.color} className={cn('ring-2 ring-panel', index > 0 && '-ml-1')}>
                      {voice.avatarText}
                    </Avatar>
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink transition-colors group-hover:text-trust-blue dark:text-paper">
                    {title}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-ink/50 dark:text-paper/50">
                    {place && <span title={place.full}>{place.label} · </span>}
                    {formatPeopleDate(transcript.created_at)} · {shown.map((voice) => voice.label).join(', ')}
                  </span>
                </span>
                <RowChevron />
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** One person's transcripts in this project and the ones nested in it. */
function PersonScreen({ project, tree, person, headingId, backRef, onBack }: {
  project: Project
  tree: ProjectTree
  person: ProjectPerson
  headingId: string
  backRef: RefObject<HTMLButtonElement | null>
  onBack: () => void
}) {
  // Keyed by person by the caller: a new person starts from skeleton rows and
  // can never show the previous person's transcripts.
  const appearances = usePersonAppearances(person.id)
  const branch = useMemo(() => new Set(activeBranchIds(tree, project.id)), [tree, project.id])
  const rows = useMemo(
    () => appearances.data?.filter((appearance) => appearance.project_id !== null && branch.has(appearance.project_id)) ?? null,
    [appearances.data, branch]
  )
  const totals = rows ? appearanceTotals(rows) : null

  return (
    <>
      <div className="border-b border-border px-5 pb-4 pt-5">
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          className="-ml-1.5 mb-3 inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 font-mono text-xs text-muted transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/60"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          People in {project.name}
        </button>
        <div className="pr-10">
          <PersonHeading person={person} titleId={headingId} />
        </div>
        {/* From the rows below, never the list's figures: the two are separate
            reads, and the line must not contradict what it sits above. It holds
            its height while they load, so nothing below moves. */}
        <p id={`${headingId}-summary`} className="mt-3 min-h-4 font-mono text-xs text-muted">
          {totals === null ? '' : totals.transcripts === 0 ? `Not in any transcript in ${project.name}`
            : `${countLabel(totals.transcripts, 'transcript', 'transcripts')} in ${project.name}`
              + ` · ${formatDuration(totals.talkMs / 1000)} speaking`
              + (totals.lastSeen ? ` · last heard ${formatPeopleDate(totals.lastSeen)}` : '')}
        </p>
        <Link
          href={personHref(person.id, null)}
          // Their People dialog takes over from this one without fading in. A
          // click that opens elsewhere (a new tab, say) leaves this tab as it is.
          onClick={(event) => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              markPersonDialogHandoff()
            }
          }}
          className="mt-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-trust-blue hover:underline"
        >
          Open in People
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
        <AppearanceList
          rows={rows}
          error={appearances.error}
          onRetry={() => void appearances.reload()}
          empty={<>{person.name} isn&apos;t in any transcript in {project.name} any more.</>}
          projectLabel={(projectId) => transcriptProjectLabel(tree, projectId, project.id)}
          action={() => <RowChevron />}
        />
      </div>
    </>
  )
}
