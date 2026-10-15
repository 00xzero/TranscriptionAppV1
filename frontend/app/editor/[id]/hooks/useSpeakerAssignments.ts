import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchEditorPeopleContext,
  fetchSegmentSpeakerAssignments,
  fetchSpeakers,
} from '@/lib/supabase/queries'
import { displayedIdentityKey, resolveSpeakerPresentation, speakerLabelFor } from '@/core/speakers/labels'
import { buildSpeakerDisplay } from '@/lib/speakers/display'
import { toast } from '@/components/ui/toaster'
import { changedSince, errorCode, isNotReady, NOT_READY_MESSAGE } from '@/lib/people/errors'
import { SendClosed, type Send } from '@/lib/editor/untilAnswered'
import { NOTHING_CHANGED, type EditorHistory, type HistoryStep } from './useEditorHistory'
import type { SegmentHolds } from './useSegmentHolds'
import type { EditorPeopleContext, Speaker } from '@/contracts/db'
import type { Seg } from '../types'
import { revisionsMatch } from '../utils'
import { mergeSpeakerAssignments } from './useEditorData'
import {
  correctAction,
  removalChanges,
  removeAction,
  renameLocalAction,
  renamePersonAction,
  RESHAPED,
  UNCHANGED,
  runOp,
  savedId,
  type ApplyTo,
  type SpeakerAction,
  type SpeakerStore,
  type SpeakerTarget,
  type SpeakerOp,
} from './speakerActions'
import type { Enqueue } from './useEditorWriteQueue'
import { useLiveStore, type LiveStore } from './useLiveStore'

export type { ApplyTo, SpeakerTarget } from './speakerActions'

type Measurable = { getBoundingClientRect(): DOMRect }
export type SpeakerPopoverCloseReason = 'dismiss' | 'outside' | 'selection' | 'external'
type SpeakerPopoverState = { segmentId: string; speakerId: string | null; anchorMeasurable: Measurable; triggerElement: HTMLElement | null }

function createStableMeasurable(el: HTMLElement): Measurable {
  let lastRect = el.getBoundingClientRect()
  return { getBoundingClientRect() { if (el.isConnected) lastRect = el.getBoundingClientRect(); return lastRect } }
}

/**
 * A speaker action's step: each undo or redo runs the op the last run
 * answered with. Built apart from the action, so the history keeps only what
 * the step needs, not the segments the action was chosen for.
 */
function speakerStep(label: string, ids: readonly string[], ops: { next?: SpeakerOp }): HistoryStep {
  return {
    label, scope: 'speaker', touches: ids,
    target: () => ({ ids: ids.filter((id) => !id.includes(':')) }),
    async run(_dir, applied) {
      if (!ops.next) throw changedSince('The action never completed')
      ops.next = await runOp(ops.next, applied)
    },
  }
}

export function useSpeakerAssignments({ transcriptId, speakers, segments, segmentsStore, peopleContext,
  setSpeakers, setPeopleContext, enqueue, reloadSegments, isLoaded, send, history, holds }: {
  transcriptId: string
  speakers: Speaker[]
  segments: Seg[]
  /** The same segments, live: actions read and change them through it. */
  segmentsStore: LiveStore<Seg[]>
  peopleContext: EditorPeopleContext
  setSpeakers: React.Dispatch<React.SetStateAction<Speaker[]>>
  setPeopleContext: React.Dispatch<React.SetStateAction<EditorPeopleContext>>
  enqueue: Enqueue
  /**
   * Reloads segments and words when they were split or rejoined elsewhere.
   * False if the database refused the read; throws SendClosed once the editor has closed.
   */
  reloadSegments: () => Promise<boolean>
  /** False until the editor's first load has shown segments. */
  isLoaded: () => boolean
  /** Sends a write or read until the database answers it. */
  send: Send
  history: EditorHistory
  /** Speaker changes wait while a segment is held, and while the editor is reconnecting. */
  holds: SegmentHolds
}) {
  // The stable parts: history and holds themselves change with every step and hold.
  const { clear: clearHistory, original } = history
  const { blocked } = holds
  const [speakerPopover, setSpeakerPopover] = useState<SpeakerPopoverState | null>(null)
  const lastTriggerElementRef = useRef<HTMLElement | null>(null)
  const closeReasonRef = useRef<SpeakerPopoverCloseReason | null>(null)
  const anchorRef = useRef<Measurable>({ getBoundingClientRect: () => new DOMRect() })

  // Speaker actions run one at a time in the editor's write queue and read the
  // latest state from live stores, which every change updates at once and
  // composes with a text edit made in the meantime.
  const speakersStore = useLiveStore(speakers, setSpeakers)
  const peopleStore = useLiveStore(peopleContext, setPeopleContext)
  const store = useMemo<SpeakerStore>(() => ({
    transcriptId, send,
    speakers: speakersStore.get,
    segments: segmentsStore.get,
    people: peopleStore.get,
    updateSpeakers: speakersStore.update,
    updateSegments: segmentsStore.update,
    updatePeople: peopleStore.update,
  }), [transcriptId, speakersStore, segmentsStore, peopleStore, send])

  // Reloads speaker data and segment assignments, never segment text — unless
  // a segment was split or rejoined elsewhere (its id or revision differs),
  // when segments and words reload whole and keep only drafts still valid.
  // Anything changed elsewhere that the history's steps rest on (a segment's
  // speaker, a speaker here, a person linked to one) clears the history. The
  // reads are sent until answered; false means the database refused one.
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const [assignments, speakerRows, people] = await send(() => Promise.all([
        fetchSegmentSpeakerAssignments(store.transcriptId),
        fetchSpeakers(store.transcriptId),
        fetchEditorPeopleContext(store.transcriptId),
      ]))
      const linkedHere = new Set(store.speakers().flatMap((sp) => sp.person_id ? [savedId(sp.person_id)] : []))
      const peopleById = new Map(people.people.map((row) => [row.id, row]))
      const externalPeople = store.people().people.some((p) => {
        if (!linkedHere.has(p.id)) return false
        const row = peopleById.get(p.id)
        return !row || row.name !== p.name || row.preferred_color !== p.preferred_color ||
          row.organisation_id !== p.organisation_id || row.hidden !== p.hidden
      })
      const speakersById = new Map(speakerRows.map((row) => [row.id, row]))
      const externalSpeakers = store.speakers().some((p) => {
        const row = speakersById.get(p.id)
        return !row || row.person_id !== p.person_id || row.custom_label !== p.custom_label
      })
      const shown = store.segments()
      const shownSpeaker = new Map(shown.map((s) => [s.id, s.speaker_id]))
      const externalAssignments = assignments.some((a) => shownSpeaker.get(a.id) !== a.speaker_id)
      if (externalPeople || externalSpeakers || externalAssignments) clearHistory('This changed elsewhere')
      const reshaped = assignments.length !== shown.length || !revisionsMatch(shown, assignments)
      if (reshaped) {
        if (!(await reloadSegments())) return false
      } else {
        store.updateSegments((rows) => mergeSpeakerAssignments(rows, assignments))
      }
      store.updateSpeakers(() => speakerRows)
      store.updatePeople(() => people)
      return true
    } catch (error) {
      if (!(error instanceof SendClosed)) console.error(`Failed to refresh speakers for transcript ${store.transcriptId}:`, error)
      return false
    }
  }, [store, send, reloadSegments, clearHistory])

  // Refresh when the user comes back to the tab. A tab switch fires both
  // events; the refresh the first one starts covers the second. Not before the
  // first load has shown segments: that load is the freshest data, and its
  // rows, read a moment earlier, would land over whatever this reloaded.
  useEffect(() => {
    let refreshing = false
    const onReturn = () => {
      if (document.visibilityState === 'hidden' || refreshing) return
      refreshing = true
      void enqueue(async () => {
        try { if (isLoaded()) await refresh() } finally { refreshing = false }
      }, 'read')
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [enqueue, refresh, isLoaded])

  const presentation = useMemo(() => resolveSpeakerPresentation(speakers, segments, peopleContext.people),
    [speakers, segments, peopleContext.people])
  const displayForSpeaker = useMemo(() => buildSpeakerDisplay(speakers, presentation, peopleContext.people),
    [speakers, presentation, peopleContext.people])
  const labelForSpeaker = useCallback((speakerId: string | null | undefined) =>
    speakerLabelFor(presentation.labels, speakerId), [presentation])
  // The speaker the picker opened on, under its saved id once a provisional
  // one is saved.
  const openedOn = speakerPopover?.speakerId ? savedId(speakerPopover.speakerId) : null
  const currentSpeaker = openedOn ? speakers.find((speaker) => speaker.id === openedOn) : undefined
  const selectedSegment = speakerPopover ? segments.find((segment) => segment.id === speakerPopover.segmentId) : undefined
  // The picker shows the speaker it opened on, while its scopes follow the
  // segment. If the segment moves to another speaker while it is open (a
  // refresh, or an action queued earlier), close it rather than show one
  // speaker and act on another. Closed during render, so the mismatch never
  // paints; focus goes back to the avatar, as on a dismiss.
  if (selectedSegment && selectedSegment.speaker_id !== openedOn) setSpeakerPopover(null)
  // The segments each Apply to scope covers. All is every segment showing the
  // current identity, however many speakers carry it.
  const scopes = useMemo<Record<ApplyTo, Seg[]>>(() => {
    if (!selectedSegment) return { speaker: [], segment: [], turn: [] }
    const key = displayedIdentityKey(presentation, selectedSegment.speaker_id)
    const sameIdentity = (segment: Seg) => displayedIdentityKey(presentation, segment.speaker_id) === key
    const index = segments.indexOf(selectedSegment)
    let start = index
    let end = index
    while (start > 0 && sameIdentity(segments[start - 1])) start--
    while (end + 1 < segments.length && sameIdentity(segments[end + 1])) end++
    return {
      speaker: selectedSegment.speaker_id ? segments.filter(sameIdentity) : [],
      segment: [selectedSegment],
      turn: segments.slice(start, end + 1),
    }
  }, [segments, selectedSegment, presentation])
  const removable = useMemo<Record<ApplyTo, boolean>>(() => ({
    speaker: removalChanges(speakers, scopes.speaker).length > 0,
    segment: removalChanges(speakers, scopes.segment).length > 0,
    turn: removalChanges(speakers, scopes.turn).length > 0,
  }), [speakers, scopes])

  const closeSpeakerPopover = useCallback((reason: SpeakerPopoverCloseReason = 'dismiss') => {
    closeReasonRef.current = reason; setSpeakerPopover(null)
  }, [])
  const handleAvatarClick = useCallback((event: React.MouseEvent, segmentId: string, speakerId: string | null) => {
    event.stopPropagation()
    if (blocked([segmentId])) return
    const element = event.currentTarget as HTMLElement
    const anchorMeasurable = createStableMeasurable(element)
    anchorRef.current = anchorMeasurable
    lastTriggerElementRef.current = element
    closeReasonRef.current = null
    // A second click on the name the picker is open for closes it.
    setSpeakerPopover((open) => open?.segmentId === segmentId
      ? null : { segmentId, speakerId, anchorMeasurable, triggerElement: element })
  }, [blocked])
  useEffect(() => {
    if (speakerPopover?.anchorMeasurable) anchorRef.current = speakerPopover.anchorMeasurable
    if (speakerPopover?.triggerElement) lastTriggerElementRef.current = speakerPopover.triggerElement
  }, [speakerPopover])

  /**
   * Runs a speaker action as a step of the editor's history (spec §7): its
   * step is recorded at once, so presses keep their order, then in the write
   * queue it applies optimistically and writes. A refusal because something
   * changed elsewhere clears the history and reads again; any other failure
   * rolls back only the action's own change and offers Retry. An action on
   * segments chosen before a split or join queued ahead of it changes nothing.
   */
  const execute = useCallback(function executeAction(
    label: string, build: () => SpeakerAction | typeof RESHAPED | typeof UNCHANGED | null, ids: readonly string[]
  ): void {
    closeSpeakerPopover('selection')
    if (blocked(ids)) return
    const ops: { next?: SpeakerOp } = {}
    let failedMessage = `Couldn't ${label}`
    const perform = async () => {
      const action = build()
      if (action === UNCHANGED) throw NOTHING_CHANGED
      if (action === RESHAPED) throw { code: 'RESHAPED' }
      if (!action) throw changedSince('What the action changes is gone')
      failedMessage = action.failed
      ops.next = await runOp(action)
    }
    original(speakerStep(label, ids, ops), perform, (error) => {
      if (isNotReady(error)) toast({ title: NOT_READY_MESSAGE, variant: 'error' })
      else if (errorCode(error) === 'RESHAPED') {
        toast({ title: 'A segment was split or joined meanwhile', description: 'Nothing changed. Choose again.', variant: 'error' })
      } else toast({ title: failedMessage, variant: 'error', action: { label: 'Retry', onClick: () => executeAction(label, build, ids) } })
    })
  }, [closeSpeakerPopover, original, blocked])

  const fromLabel = labelForSpeaker(selectedSegment?.speaker_id)

  const selectTarget = useCallback((target: SpeakerTarget, applyTo: ApplyTo) => {
    const chosen = scopes[applyTo]
    execute('speaker change', () => correctAction(store, { chosen, applyTo, target, fromLabel, labelForSpeaker }), [...chosen.map(s => s.id), ...(target.kind === 'person' ? [`person:${target.id}`] : [])])
  }, [scopes, execute, store, fromLabel, labelForSpeaker])

  const removeSpeaker = useCallback((applyTo: ApplyTo) => {
    const chosen = scopes[applyTo]
    execute('remove speaker', () => removeAction(store, { chosen, applyTo, fromLabel }), chosen.map(s => s.id))
  }, [scopes, execute, store, fromLabel])

  const renameLocal = useCallback((label: string) => {
    const speakerId = currentSpeaker?.id
    const chosen = scopes.speaker
    // Unchanged: nothing to write, nothing to record.
    if (currentSpeaker?.custom_label === label) { closeSpeakerPopover('selection'); return }
    if (speakerId) execute('rename speaker', () => renameLocalAction(store, { speakerId, label, chosen, fromLabel }), [...chosen.map(s => s.id), `speaker:${speakerId}`])
  }, [currentSpeaker, scopes, execute, store, fromLabel, closeSpeakerPopover])

  const renameLinkedPerson = useCallback((name: string) => {
    const personId = currentSpeaker?.person_id
    if (personId && store.people().people.find((p) => p.id === savedId(personId))?.name === name) {
      closeSpeakerPopover('selection'); return
    }
    if (personId) execute('rename person', () => renamePersonAction(store, personId, name), [...store.segments().filter(s => store.speakers().some(sp => sp.id === s.speaker_id && sp.person_id === personId)).map(s => s.id), `person:${personId}`])
  }, [currentSpeaker, execute, store, closeSpeakerPopover])

  return { speakerPopover, setSpeakerPopover, closeSpeakerPopover, closeReasonRef,
    lastTriggerElementRef, anchorRef, presentation, displayForSpeaker, labelForSpeaker,
    currentSpeaker, selectedSegment, scopes, removable,
    handleAvatarClick, selectTarget, removeSpeaker, renameLocal, renameLinkedPerson, refresh }
}
