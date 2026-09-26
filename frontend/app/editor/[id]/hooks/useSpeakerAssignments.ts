import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchEditorPeopleContext,
  fetchSegmentSpeakerAssignments,
  fetchSpeakers,
} from '@/lib/supabase/queries'
import { displayedIdentityKey, resolveSpeakerPresentation, speakerLabelFor } from '@/core/speakers/labels'
import { buildSpeakerDisplay } from '@/lib/speakers/display'
import { toast } from '@/components/ui/toaster'
import type { EditorPeopleContext, Speaker } from '@/contracts/db'
import type { Seg } from '../types'
import { mergeSpeakerAssignments } from './useEditorData'
import {
  correctAction,
  removalChanges,
  removeAction,
  renameLocalAction,
  renamePersonAction,
  type ApplyTo,
  type SpeakerAction,
  type SpeakerStore,
  type SpeakerTarget,
  type SpeakerUndo,
} from './speakerActions'

export type { ApplyTo, SpeakerTarget } from './speakerActions'

type Measurable = { getBoundingClientRect(): DOMRect }
export type SpeakerPopoverCloseReason = 'dismiss' | 'outside' | 'selection' | 'external'
type SpeakerPopoverState = { segmentId: string; speakerId: string | null; anchorMeasurable: Measurable; triggerElement: HTMLElement | null }

const UNDO_WINDOW_MS = 8000
const CONFLICT_TOAST = 'Changed in another tab — refreshed'
const isConflict = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'SP002'

function createStableMeasurable(el: HTMLElement): Measurable {
  let lastRect = el.getBoundingClientRect()
  return { getBoundingClientRect() { if (el.isConnected) lastRect = el.getBoundingClientRect(); return lastRect } }
}

export function useSpeakerAssignments({ transcriptId, speakers, segments, peopleContext,
  setSpeakers, setSegments, setPeopleContext }: {
  transcriptId: string
  speakers: Speaker[]
  segments: Seg[]
  peopleContext: EditorPeopleContext
  setSpeakers: React.Dispatch<React.SetStateAction<Speaker[]>>
  setSegments: React.Dispatch<React.SetStateAction<Seg[]>>
  setPeopleContext: React.Dispatch<React.SetStateAction<EditorPeopleContext>>
}) {
  const [speakerPopover, setSpeakerPopover] = useState<SpeakerPopoverState | null>(null)
  const lastTriggerElementRef = useRef<HTMLElement | null>(null)
  const closeReasonRef = useRef<SpeakerPopoverCloseReason | null>(null)
  const anchorRef = useRef<Measurable>({ getBoundingClientRect: () => new DOMRect() })

  // Speaker actions run one at a time and read the latest state from these
  // refs, which every change updates at once. The setters get updater
  // functions, so a change composes with a text edit made in the meantime.
  const speakersRef = useRef(speakers)
  const segmentsRef = useRef(segments)
  const peopleRef = useRef(peopleContext)
  useEffect(() => { speakersRef.current = speakers }, [speakers])
  useEffect(() => { segmentsRef.current = segments }, [segments])
  useEffect(() => { peopleRef.current = peopleContext }, [peopleContext])
  const store = useMemo<SpeakerStore>(() => ({
    transcriptId,
    speakers: () => speakersRef.current,
    segments: () => segmentsRef.current,
    people: () => peopleRef.current,
    updateSpeakers(edit) { speakersRef.current = edit(speakersRef.current); setSpeakers(edit) },
    updateSegments(edit) { segmentsRef.current = edit(segmentsRef.current); setSegments(edit) },
    updatePeople(edit) { peopleRef.current = edit(peopleRef.current); setPeopleContext(edit) },
  }), [transcriptId, setSpeakers, setSegments, setPeopleContext])

  const queueRef = useRef(Promise.resolve())
  const enqueue = useCallback((task: () => Promise<void>) => {
    const next = queueRef.current.then(task, task)
    queueRef.current = next.catch(() => undefined)
    return next
  }, [])

  // Reloads speaker data and segment assignments, never segment text.
  // Resolves false when it fails, so a caller can undo its optimistic change.
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const [assignments, speakerRows, people] = await Promise.all([
        fetchSegmentSpeakerAssignments(store.transcriptId),
        fetchSpeakers(store.transcriptId),
        fetchEditorPeopleContext(store.transcriptId),
      ])
      store.updateSegments((rows) => mergeSpeakerAssignments(rows, assignments))
      store.updateSpeakers(() => speakerRows)
      store.updatePeople(() => people)
      return true
    } catch (error) {
      console.error(`Failed to refresh speakers for transcript ${store.transcriptId}:`, error)
      return false
    }
  }, [store])

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
  const currentSpeaker = speakerPopover?.speakerId
    ? speakers.find((speaker) => speaker.id === speakerPopover.speakerId) : undefined
  const selectedSegment = speakerPopover ? segments.find((segment) => segment.id === speakerPopover.segmentId) : undefined
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
    setSpeakerPopover({ segmentId, speakerId, anchorMeasurable, triggerElement: element })
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

    function run() {
      void enqueue(async () => {
        const action = build()
        if (!action) {
          await refresh()
          toast({ title: CONFLICT_TOAST, variant: 'error' })
          return
        }
        action.apply()
        try {
          const undo = await action.write()
          toast({ title: action.done, durationMs: UNDO_WINDOW_MS,
            action: { label: 'Undo', onClick: () => void enqueue(() => runUndo(undo)) } })
        } catch (error) {
          if (isConflict(error)) {
            if (!(await refresh())) action.restore()
            toast({ title: CONFLICT_TOAST, variant: 'error' })
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
        if (isConflict(error)) {
          if (!(await refresh())) undo.restore()
          toast({ title: "Can't undo — changed since", variant: 'error' })
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
