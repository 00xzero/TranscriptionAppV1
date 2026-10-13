import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchEditorPeopleContext,
  fetchSegmentSpeakerAssignments,
  fetchSpeakers,
} from '@/lib/supabase/queries'
import { displayedIdentityKey, resolveSpeakerPresentation, speakerLabelFor } from '@/core/speakers/labels'
import { buildSpeakerDisplay } from '@/lib/speakers/display'
import { toast } from '@/components/ui/toaster'
import { CONFLICT_TOAST, DROPPED_DRAFT_MESSAGE, STALE_TOAST, isConflict, isGone, isNotReady, NOT_READY_MESSAGE } from '@/lib/people/errors'
import type { EditorPeopleContext, Speaker } from '@/contracts/db'
import type { Seg } from '../types'
import { mergeSpeakerAssignments } from './useEditorData'
import {
  correctAction,
  removalChanges,
  removeAction,
  renameLocalAction,
  renamePersonAction,
  savedId,
  type ApplyTo,
  type SpeakerAction,
  type SpeakerStore,
  type SpeakerTarget,
  type SpeakerUndo,
} from './speakerActions'
import { UNDO_WINDOW_MS, type Enqueue } from './useEditorWriteQueue'
import type { LiveStore } from './useLiveStore'
import type { ReloadResult } from './useTranscriptMutations'

export type { ApplyTo, SpeakerTarget } from './speakerActions'

type Measurable = { getBoundingClientRect(): DOMRect }
export type SpeakerPopoverCloseReason = 'dismiss' | 'outside' | 'selection' | 'external'
type SpeakerPopoverState = { segmentId: string; speakerId: string | null; anchorMeasurable: Measurable; triggerElement: HTMLElement | null }

function createStableMeasurable(el: HTMLElement): Measurable {
  let lastRect = el.getBoundingClientRect()
  return { getBoundingClientRect() { if (el.isConnected) lastRect = el.getBoundingClientRect(); return lastRect } }
}

export function useSpeakerAssignments({ transcriptId, speakers, segments, segmentsStore, peopleContext,
  setSpeakers, setPeopleContext, enqueue, reloadSegments }: {
  transcriptId: string
  speakers: Speaker[]
  segments: Seg[]
  /** The same segments, live: actions read and change them through it. */
  segmentsStore: LiveStore<Seg[]>
  peopleContext: EditorPeopleContext
  setSpeakers: React.Dispatch<React.SetStateAction<Speaker[]>>
  setPeopleContext: React.Dispatch<React.SetStateAction<EditorPeopleContext>>
  enqueue: Enqueue
  /** Reloads segments and words when they were split or rejoined elsewhere. */
  reloadSegments: () => Promise<ReloadResult | null>
}) {
  const [speakerPopover, setSpeakerPopover] = useState<SpeakerPopoverState | null>(null)
  const lastTriggerElementRef = useRef<HTMLElement | null>(null)
  const closeReasonRef = useRef<SpeakerPopoverCloseReason | null>(null)
  const anchorRef = useRef<Measurable>({ getBoundingClientRect: () => new DOMRect() })

  // Speaker actions run one at a time in the editor's write queue and read the
  // latest state from these refs and the segments store, which every change
  // updates at once. The setters get updater functions, so a change composes
  // with a text edit made in the meantime.
  const speakersRef = useRef(speakers)
  const peopleRef = useRef(peopleContext)
  useEffect(() => { speakersRef.current = speakers }, [speakers])
  useEffect(() => { peopleRef.current = peopleContext }, [peopleContext])
  const store = useMemo<SpeakerStore>(() => ({
    transcriptId,
    speakers: () => speakersRef.current,
    segments: () => segmentsStore.get(),
    people: () => peopleRef.current,
    updateSpeakers(edit) { speakersRef.current = edit(speakersRef.current); setSpeakers(edit) },
    updateSegments(edit) { segmentsStore.update(edit) },
    updatePeople(edit) { peopleRef.current = edit(peopleRef.current); setPeopleContext(edit) },
  }), [transcriptId, segmentsStore, setSpeakers, setPeopleContext])

  // Reloads speaker data and segment assignments, never segment text — unless
  // a segment was split or rejoined elsewhere (its id or revision differs),
  // when segments and words reload whole and keep only drafts still valid.
  // Resolves false when it fails, so a caller can undo its optimistic change.
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const [assignments, speakerRows, people] = await Promise.all([
        fetchSegmentSpeakerAssignments(store.transcriptId),
        fetchSpeakers(store.transcriptId),
        fetchEditorPeopleContext(store.transcriptId),
      ])
      const localRevision = new Map(store.segments().map((segment) => [segment.id, segment.revision]))
      const reshaped = assignments.length !== localRevision.size ||
        assignments.some((a) => localRevision.get(a.id) !== a.revision)
      if (reshaped) {
        const reloaded = await reloadSegments()
        if (!reloaded) return false
        if (reloaded.droppedDrafts > 0) toast({ title: CONFLICT_TOAST, description: DROPPED_DRAFT_MESSAGE, variant: 'error' })
      } else {
        store.updateSegments((rows) => mergeSpeakerAssignments(rows, assignments))
      }
      store.updateSpeakers(() => speakerRows)
      store.updatePeople(() => people)
      return true
    } catch (error) {
      console.error(`Failed to refresh speakers for transcript ${store.transcriptId}:`, error)
      return false
    }
  }, [store, reloadSegments])

  // Refresh when the user comes back to the tab. A tab switch fires both
  // events; the refresh the first one starts covers the second.
  useEffect(() => {
    let refreshing = false
    const onReturn = () => {
      if (document.visibilityState === 'hidden' || refreshing) return
      refreshing = true
      void enqueue(async () => {
        try { await refresh() } finally { refreshing = false }
      })
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [enqueue, refresh])

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
    const element = event.currentTarget as HTMLElement
    const anchorMeasurable = createStableMeasurable(element)
    anchorRef.current = anchorMeasurable
    lastTriggerElementRef.current = element
    closeReasonRef.current = null
    // A second click on the name the picker is open for closes it.
    setSpeakerPopover((open) => open?.segmentId === segmentId
      ? null : { segmentId, speakerId, anchorMeasurable, triggerElement: element })
  }, [])
  useEffect(() => {
    if (speakerPopover?.anchorMeasurable) anchorRef.current = speakerPopover.anchorMeasurable
    if (speakerPopover?.triggerElement) lastTriggerElementRef.current = speakerPopover.triggerElement
  }, [speakerPopover])

  /**
   * Runs an action in the queue (spec §7): apply optimistically, write, then
   * offer Undo. A refused write refreshes speaker data; any other failure
   * rolls back only the action's own change and offers Retry.
   */
  const execute = useCallback((build: () => SpeakerAction | null) => {
    closeSpeakerPopover('selection')

    // After a refused write: refresh, and say it refreshed only if it did.
    async function refreshAfterConflict(title: string): Promise<boolean> {
      const refreshed = await refresh()
      toast(refreshed ? { title, variant: 'error' } : { title: STALE_TOAST, variant: 'error',
        action: { label: 'Retry', onClick: () => void enqueue(async () => { await refreshAfterConflict(title) }) } })
      return refreshed
    }

    function run() {
      void enqueue(async () => {
        const action = build()
        if (!action) {
          await refreshAfterConflict(CONFLICT_TOAST)
          return
        }
        action.apply()
        try {
          const undo = await action.write()
          toast({ title: action.done, durationMs: UNDO_WINDOW_MS,
            action: { label: 'Undo', onClick: () => void enqueue(() => runUndo(undo)) } })
        } catch (error) {
          if (isConflict(error) || isGone(error)) {
            if (!(await refreshAfterConflict(isGone(error) ? 'That person or speaker no longer exists.' : CONFLICT_TOAST))) action.restore()
          } else if (isNotReady(error)) {
            action.restore()
            toast({ title: NOT_READY_MESSAGE, variant: 'error' })
          } else {
            action.restore()
            toast({ title: action.failed, variant: 'error', action: { label: 'Retry', onClick: run } })
          }
        }
      })
    }

    async function runUndo(undo: SpeakerUndo) {
      undo.apply()
      try {
        await undo.write()
      } catch (error) {
        if (isConflict(error) || isGone(error)) {
          if (!(await refreshAfterConflict("Can't undo — changed since"))) undo.restore()
        } else if (isNotReady(error)) {
          undo.restore()
          toast({ title: NOT_READY_MESSAGE, variant: 'error' })
        } else {
          undo.restore()
          toast({ title: "Couldn't undo", variant: 'error',
            action: { label: 'Retry', onClick: () => void enqueue(() => runUndo(undo)) } })
        }
      }
    }

    run()
  }, [closeSpeakerPopover, enqueue, refresh])

  const fromLabel = labelForSpeaker(selectedSegment?.speaker_id)

  const selectTarget = useCallback((target: SpeakerTarget, applyTo: ApplyTo) => {
    const segmentIds = new Set(scopes[applyTo].map((segment) => segment.id))
    execute(() => correctAction(store, { segmentIds, applyTo, target, fromLabel, labelForSpeaker }))
  }, [scopes, execute, store, fromLabel, labelForSpeaker])

  const removeSpeaker = useCallback((applyTo: ApplyTo) => {
    const segmentIds = new Set(scopes[applyTo].map((segment) => segment.id))
    execute(() => removeAction(store, { segmentIds, applyTo, fromLabel, labelForSpeaker }))
  }, [scopes, execute, store, fromLabel, labelForSpeaker])

  const renameLocal = useCallback((label: string) => {
    const speakerId = currentSpeaker?.id
    const segmentIds = new Set(scopes.speaker.map((segment) => segment.id))
    if (speakerId) execute(() => renameLocalAction(store, { speakerId, label, segmentIds, fromLabel }))
  }, [currentSpeaker, scopes, execute, store, fromLabel])

  const renameLinkedPerson = useCallback((name: string) => {
    const personId = currentSpeaker?.person_id
    if (personId) execute(() => renamePersonAction(store, personId, name))
  }, [currentSpeaker, execute, store])

  return { speakerPopover, setSpeakerPopover, closeSpeakerPopover, closeReasonRef,
    lastTriggerElementRef, anchorRef, presentation, displayForSpeaker, labelForSpeaker,
    currentSpeaker, selectedSegment, scopes, removable,
    handleAvatarClick, selectTarget, removeSpeaker, renameLocal, renameLinkedPerson }
}
