"use client"

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Plus, Search } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { CharacterCount } from '@/components/ui/character-count'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { countLabel } from '@/components/Projects/format'
import { TEXT_LIMITS } from '@/contracts/limits'
import type { SpeakerIdentity, SpeakerPresentation } from '@/core/speakers/labels'
import { speakerInitials } from '@/lib/speakers/palette'
import type { SpeakerDisplay } from '@/lib/speakers/display'
import type { EditorPeopleContext, EditorPerson, Speaker } from '@/contracts/db'
import type { Seg } from '@/app/editor/[id]/types'
import { msToTimestamp } from '@/app/editor/[id]/utils'
import type { ApplyTo, SpeakerTarget } from '@/app/editor/[id]/hooks/useSpeakerAssignments'

type Props = {
  presentation: SpeakerPresentation
  peopleContext: EditorPeopleContext
  currentSpeaker?: Speaker
  /** The segments each Apply to scope covers. */
  scopes: Readonly<Record<ApplyTo, readonly Seg[]>>
  /** Whether Remove would change anything in each scope. */
  removable: Readonly<Record<ApplyTo, boolean>>
  labelForSpeaker: (id: string | null) => string
  displayForSpeaker: (id: string | null) => SpeakerDisplay
  onSelectTarget: (target: SpeakerTarget, applyTo: ApplyTo) => void
  onRemove: (applyTo: ApplyTo) => void
  onRenameLocal: (label: string) => void
  onRenamePerson: (name: string) => void
  onHoldOpenChange?: (hold: boolean) => void
}

/** One row the user can pick; picking it applies at once (Undo is in the toast). */
type Option = {
  key: string
  target: SpeakerTarget
  label: string
  detail: string | null
  avatar: { text: string; color: string } | 'create'
}

const NAME_LIMIT = TEXT_LIMITS.speakerName
const SUGGESTION_LIMIT = 6
const TOO_LONG = `Names must be ${NAME_LIMIT} characters or fewer.`
const SPLIT_HINT = "Speaker changes partway through a segment? Splitting isn't available yet — assign the segment to whoever says most of it."
const nameLength = (name: string) => Array.from(name.trim()).length
const isValidName = (name: string) => nameLength(name) > 0 && nameLength(name) <= NAME_LIMIT
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
const segmentCount = (count: number) => countLabel(count, 'segment', 'segments')

/**
 * Picker order (spec §5): people in this transcript by first appearance, then
 * people from this transcript's project, then everyone by most recently seen.
 * Ranking only orders; nothing is assigned without the user choosing it.
 */
export function rankPeople(people: readonly EditorPerson[], transcriptPersonIds: readonly string[]): EditorPerson[] {
  const appearance = new Map(transcriptPersonIds.map((id, index) => [id, index]))
  const group = (person: EditorPerson) => appearance.has(person.id) ? 0 : person.in_project ? 1 : 2
  return [...people].sort((a, b) =>
    group(a) - group(b) ||
    (appearance.get(a.id) ?? 0) - (appearance.get(b.id) ?? 0) ||
    (b.last_other_seen_at ?? '').localeCompare(a.last_other_seen_at ?? '') ||
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** What tells namesakes apart: `ACME · last in "Q3 steering", 12 Sep`. */
function contextLine(person: EditorPerson): string | null {
  const lastSeen = person.last_other_title && person.last_other_seen_at
    ? `last in “${person.last_other_title}”, ${new Date(person.last_other_seen_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    : null
  return [person.organisation_name, lastSeen].filter(Boolean).join(' · ') || null
}

function passageSpan(segments: readonly Seg[]): string {
  if (segments.length === 0) return ''
  const start = Math.min(...segments.map((segment) => segment.start_ms))
  const end = Math.max(...segments.map((segment) => segment.end_ms))
  return `${segmentCount(segments.length)}, ${msToTimestamp(start)}–${msToTimestamp(end)}`
}

export default function SpeakerPopoverContent({ presentation, peopleContext, currentSpeaker, scopes, removable,
  labelForSpeaker, displayForSpeaker, onSelectTarget, onRemove, onRenameLocal, onRenamePerson,
  onHoldOpenChange }: Props) {
  const personById = useMemo(() => new Map(peopleContext.people.map((person) => [person.id, person])),
    [peopleContext.people])
  const transcriptPersonIds = useMemo(() =>
    presentation.identities.flatMap((identity) => identity.personId ? [identity.personId] : []), [presentation])
  const ranked = useMemo(() => rankPeople(peopleContext.people, transcriptPersonIds),
    [peopleContext.people, transcriptPersonIds])
  const linked = currentSpeaker?.person_id ? personById.get(currentSpeaker.person_id) : undefined
  const current = displayForSpeaker(currentSpeaker?.id ?? null)

  // Identifying is the likely intent for a generic voice; correcting for a named one.
  const [applyTo, setApplyTo] = useState<ApplyTo>(() =>
    currentSpeaker && !currentSpeaker.person_id && !currentSpeaker.custom_label ? 'speaker' : 'segment')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [rename, setRename] = useState(() => linked?.name ?? currentSpeaker?.custom_label ?? '')
  // Set by an attempt to save a name over the limit; the message then shows while it stays over.
  const [blocked, setBlocked] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const listId = `${id}-list`

  useEffect(() => { searchRef.current?.focus() }, [])
  const queryTooLong = nameLength(query) > NAME_LIMIT
  const renameTooLong = nameLength(rename) > NAME_LIMIT
  // Keep the popover open while a name is over the limit, so the error stays visible.
  const tooLong = queryTooLong || renameTooLong
  useEffect(() => { onHoldOpenChange?.(tooLong) }, [tooLong, onHoldOpenChange])
  useEffect(() => () => onHoldOpenChange?.(false), [onHoldOpenChange])
  useEffect(() => { document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' }) },
    [active, listId])

  // Rows. The current identity is shown on its own, never as a choice.
  const speakerIdByKey = new Map<string, string>()
  for (const speakerId of presentation.usedSpeakerIds) {
    const key = presentation.identityKeys.get(speakerId)!
    if (!speakerIdByKey.has(key)) speakerIdByKey.set(key, speakerId)
  }
  const choosable = presentation.identities.filter((identity) =>
    identity.key !== current.identityKey && (identity.personId || applyTo !== 'speaker'))
  const identityOption = (identity: SpeakerIdentity): Option => {
    const speakerId = speakerIdByKey.get(identity.key)!
    const display = displayForSpeaker(speakerId)
    const person = identity.personId ? personById.get(identity.personId) : undefined
    return {
      key: identity.key,
      target: identity.personId ? { kind: 'person', id: identity.personId } : { kind: 'speaker', id: speakerId },
      label: identity.label,
      detail: person ? contextLine(person) : null,
      avatar: { text: display.avatarText, color: display.color },
    }
  }
  const personOption = (person: EditorPerson): Option => ({
    key: `person:${person.id}`,
    target: { kind: 'person', id: person.id },
    label: person.name,
    detail: contextLine(person),
    avatar: { text: speakerInitials(person.name), color: person.preferred_color },
  })
  // A search result already in this transcript looks as it does on the page,
  // so namesakes keep their `Paul (2)` and colours match.
  const identityByPerson = new Map(presentation.identities.flatMap((identity) =>
    identity.personId ? [[identity.personId, identity] as const] : []))
  const resultOption = (person: EditorPerson): Option => {
    const identity = identityByPerson.get(person.id)
    return identity ? identityOption(identity) : personOption(person)
  }

  const name = query.trim()
  const search = name.toLocaleLowerCase()
  const inTranscript = new Set(transcriptPersonIds)
  const matches = (text: string) => text.toLocaleLowerCase().includes(search)
  const found = search ? ranked.filter((person) => `person:${person.id}` !== current.identityKey &&
    matches(`${person.name} ${person.organisation_name ?? ''}`)) : []
  const sections: { title: string; options: Option[] }[] = search
    ? [{ title: 'Results', options: [
      ...found.filter((person) => !person.hidden).map(resultOption),
      ...choosable.filter((identity) => !identity.personId && matches(identity.label)).map(identityOption),
    ] }]
    : [
      { title: 'In this transcript', options: choosable.map(identityOption) },
      { title: 'Suggested', options: ranked
        .filter((person) => !person.hidden && !inTranscript.has(person.id))
        .slice(0, SUGGESTION_LIMIT).map(personOption) },
    ]
  const hidden = found.filter((person) => person.hidden).map(resultOption)
  const createAnother = peopleContext.people.some((person) => sameName(person.name, name))
  const create: Option | null = search && !queryTooLong
    ? { key: 'create', target: { kind: 'new-person', name }, detail: null, avatar: 'create',
      label: `${createAnother ? 'Create another' : 'Create'} “${name}”` }
    : null
  const options = [...sections.flatMap((section) => section.options),
    ...(hiddenOpen ? hidden : []), ...(create ? [create] : [])]
  const choose = (option: Option) => onSelectTarget(option.target, applyTo)
  const chooseCreate = () => create ? choose(create) : setBlocked(true)
  const indexOf = (option: Option) => options.indexOf(option)
  const row = (option: Option) => (
    <OptionRow key={option.key} option={option} id={`${listId}-${indexOf(option)}`}
      active={indexOf(option) === active} onHover={() => setActive(indexOf(option))} onChoose={() => choose(option)} />
  )

  if (renaming && currentSpeaker) {
    const namesakes = !linked && isValidName(rename)
      ? peopleContext.people.filter((person) => sameName(person.name, rename)) : []
    const save = (event: React.FormEvent) => {
      event.preventDefault()
      if (renameTooLong) setBlocked(true)
      else if (!isValidName(rename)) return
      else if (linked) onRenamePerson(rename.trim())
      else onRenameLocal(rename.trim())
    }
    return (
      <div className="p-3 text-foreground">
        <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)} className="-ml-3 mb-1 gap-1">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
        </Button>
        <Label htmlFor={`${id}-rename`} className="block text-xs">
          {linked
            ? `Rename person everywhere · ${countLabel(linked.other_transcript_count + (inTranscript.has(linked.id) ? 1 : 0), 'transcript', 'transcripts')}`
            : 'Rename in this transcript only'}
        </Label>
        <form onSubmit={save} className="mt-1.5 flex gap-1.5">
          <NameField id={`${id}-rename`} value={rename} tooLong={renameTooLong} autoFocus
            onChange={(event) => setRename(event.target.value)} placeholder={current.label} />
          <Button type="submit" variant="primary" size="sm" disabled={nameLength(rename) === 0}>Save</Button>
        </form>
        {blocked && renameTooLong && <p role="alert" className="mt-1 text-xs text-ember-red">{TOO_LONG}</p>}
        {namesakes.map((person) => (
          <Button key={person.id} type="button" variant="ghost" size="sm" className="mt-1 w-full justify-start px-2"
            onClick={() => onSelectTarget({ kind: 'person', id: person.id }, 'speaker')}>
            Use existing person: {person.name}{person.organisation_name ? ` · ${person.organisation_name}` : ''}
          </Button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex max-h-[min(560px,var(--radix-popover-content-available-height))] flex-col text-foreground">
      <div className="flex items-center gap-2 px-3 pb-1 pt-3">
        {/* The icon follows the field so it paints over the field's focused fill. */}
        <div className="relative min-w-0 flex-1">
          <NameField id={`${id}-search`} ref={searchRef} value={query} tooLong={queryTooLong} className="pl-8"
            placeholder="Search or add a person" aria-label="Search or add a person"
            role="combobox" aria-expanded aria-controls={listId}
            aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value)
              setHiddenOpen(false)
              setActive(event.target.value.trim() ? 0 : -1)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, options.length - 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
              else if (event.key === 'Enter' && (options[active] || search)) {
                event.preventDefault()
                if (options[active]) choose(options[active])
                else chooseCreate()
              }
            }} />
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        </div>
        {search && (
          <Button type="button" variant="primary" size="sm" onClick={chooseCreate}>
            {createAnother ? 'Add another' : 'Add'}
          </Button>
        )}
      </div>
      {blocked && queryTooLong && <p role="alert" className="px-3 text-xs text-ember-red">{TOO_LONG}</p>}

      <Tabs value={applyTo} onValueChange={(value) => setApplyTo(value as ApplyTo)} className="flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="Apply to" className="px-3">
          {currentSpeaker && (
            <ScopeTab value="speaker" label={`All ${segmentCount(scopes.speaker.length)}`}
              hint={`Every segment of ${labelForSpeaker(currentSpeaker.id)} in this transcript`}>
              All {scopes.speaker.length}
            </ScopeTab>
          )}
          <ScopeTab value="segment" hint={SPLIT_HINT}>This segment</ScopeTab>
          <ScopeTab value="turn" hint={passageSpan(scopes.turn)}>This turn · {scopes.turn.length}</ScopeTab>
        </TabsList>

        {/* One panel whatever the scope: the scope changes which rows it offers and what a click does. */}
        <TabsContent value={applyTo} className="min-h-0 flex-1 overflow-y-auto py-1">
          <div id={listId} role="listbox" aria-label="People and speakers">
            {/* Current stays while searching, so Remove is always one click away. */}
            <SectionTitle>Current</SectionTitle>
            <div className="flex items-center gap-2.5 px-3 py-1.5">
              <Avatar size="sm" color={current.color}>{current.avatarText}</Avatar>
              <span className="min-w-0 flex-1 truncate text-sm">{current.label}</span>
              {removable[applyTo] && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(applyTo)}
                      aria-label={applyTo === 'speaker' ? `Remove ${current.label}` : `Remove ${current.label} from this ${applyTo}`}>
                      Remove
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">Back to the speaker Deepgram detected</TooltipContent>
                </Tooltip>
              )}
            </div>
            {sections.map((section) => section.options.length > 0 && (
              <div key={section.title} role="group" aria-label={section.title}>
                <SectionTitle>{section.title}</SectionTitle>
                {section.options.map(row)}
              </div>
            ))}
            {hidden.length > 0 && (
              <>
                <Button type="button" variant="ghost" size="sm" aria-expanded={hiddenOpen}
                  onClick={() => setHiddenOpen((open) => !open)} className="w-full justify-start gap-1">
                  Hidden ({hidden.length})
                  {hiddenOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                </Button>
                {hiddenOpen && hidden.map(row)}
              </>
            )}
            {create && row(create)}
          </div>
        </TabsContent>
      </Tabs>

      {currentSpeaker && (
        <div className="border-t border-border px-1.5 py-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(true)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {linked ? 'Rename person everywhere' : 'Rename in this transcript'}
          </Button>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-1 pt-2 text-xs text-muted">{children}</div>
}

/** A name input with the app's character count, which shows near the limit. */
function NameField({ id, tooLong, className, ...props }: React.ComponentPropsWithRef<typeof Input> & {
  id: string; tooLong: boolean
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Input id={id} aria-describedby={`${id}-count`} aria-invalid={tooLong || undefined}
        className={`h-8 py-0 pr-12 ${className ?? ''}`} {...props} />
      <CharacterCount id={`${id}-count`} length={nameLength(String(props.value ?? ''))} max={NAME_LIMIT}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
    </div>
  )
}

function OptionRow({ option, id, active, onHover, onChoose }: {
  option: Option; id: string; active: boolean; onHover: () => void; onChoose: () => void
}) {
  return (
    <button type="button" role="option" id={id} aria-selected={active} onMouseEnter={onHover} onClick={onChoose}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${active ? 'bg-subtle' : ''}`}>
      {option.avatar === 'create'
        ? <Avatar size="sm" className="bg-control text-muted"><Plus className="h-3.5 w-3.5" /></Avatar>
        : <Avatar size="sm" color={option.avatar.color}>{option.avatar.text}</Avatar>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{option.label}</span>
        {option.detail && <span className="block truncate text-xs text-muted">{option.detail}</span>}
      </span>
    </button>
  )
}

/**
 * An Apply to tab; its tooltip says exactly which segments it covers. The tab
 * wraps the tooltip trigger, not the reverse: the outer primitive's data-state
 * wins, and the tab's active state is what styles it.
 */
function ScopeTab({ value, label, hint, children }: {
  value: ApplyTo; label?: string; hint: string; children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TabsTrigger value={value} aria-label={label} className="whitespace-nowrap" asChild>
        <TooltipTrigger>{children}</TooltipTrigger>
      </TabsTrigger>
      <TooltipContent className="max-w-64">{hint}</TooltipContent>
    </Tooltip>
  )
}
