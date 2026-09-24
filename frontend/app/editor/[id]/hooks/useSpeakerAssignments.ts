import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  assignSegmentsToNewSpeaker,
  reassignSegments,
  setSpeakerCustomLabel,
} from '@/lib/supabase/queries'
import { resolveSpeakerLabels, speakerLabelFor } from '@/core/speakers/labels'
import { buildSpeakerColorMap, SPEAKER_COLOR_FALLBACK } from '@/lib/speakers/palette'
import type { Seg, Speaker } from '../types'

type Measurable = {
  getBoundingClientRect(): DOMRect
}

export type SpeakerPopoverCloseReason = 'dismiss' | 'outside' | 'selection' | 'external'

type SpeakerPopoverState = {
  segmentId: string
  speakerId: string | null
  anchorMeasurable: Measurable
  triggerElement: HTMLElement | null
}

function createStableMeasurable(el: HTMLElement): Measurable {
  let lastRect = el.getBoundingClientRect()

  return {
    getBoundingClientRect() {
      if (el.isConnected) {
        lastRect = el.getBoundingClientRect()
      }
      return lastRect
    },
  }
}

export function useSpeakerAssignments({
  transcriptId,
  speakers,
  segments,
  setSpeakers,
  setSegments,
  reloadSpeakerAssignments,
}: {
  transcriptId: string
  speakers: Speaker[]
  segments: Seg[]
  setSpeakers: React.Dispatch<React.SetStateAction<Speaker[]>>
  setSegments: React.Dispatch<React.SetStateAction<Seg[]>>
  /**
   * Refetches speakers and segment assignments, never segment text. Resolves
   * false if the refresh failed too.
   */
  reloadSpeakerAssignments: () => Promise<boolean>
}) {
  const [speakerPopover, setSpeakerPopover] = useState<SpeakerPopoverState | null>(null)
  const lastTriggerElementRef = useRef<HTMLElement | null>(null)
  const closeReasonRef = useRef<SpeakerPopoverCloseReason | null>(null)

  const speakersMap = useMemo(() => {
    const m = new Map<string, Speaker>()
    speakers.forEach((sp) => m.set(sp.id, sp))
    return m
  }, [speakers])

  // Array position is the palette index, so `speakers` must stay in
  // fetchSpeakers' (created_at, id) order for these colors to match the ones
  // project_speaker_summaries computes for the same transcript.
  const speakerColorMap = useMemo(() => buildSpeakerColorMap(speakers), [speakers])

  const colorForSpeaker = useCallback((sp?: Speaker) => {
    if (!sp) return SPEAKER_COLOR_FALLBACK
    return speakerColorMap.get(sp.id) || SPEAKER_COLOR_FALLBACK
  }, [speakerColorMap])

  // Every label the editor shows comes from the shared resolver, including
  // `Unknown speaker` for unassigned segments.
  const speakerLabels = useMemo(() => resolveSpeakerLabels(speakers, segments), [speakers, segments])

  const labelForSpeaker = useCallback(
    (speakerId: string | null | undefined) => speakerLabelFor(speakerLabels, speakerId),
    [speakerLabels]
  )

  // The speaker a segment holds now: what a guarded write expects to replace.
  const segmentsRef = useRef(segments)
  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])
  const currentSpeakerIdOf = useCallback(
    (segmentId: string) => segmentsRef.current.find(s => s.id === segmentId)?.speaker_id ?? null,
    []
  )

  const handleAvatarClick = useCallback((e: React.MouseEvent, segmentId: string, speakerId: string | null) => {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const anchorMeasurable = createStableMeasurable(el)
    anchorRef.current = anchorMeasurable
    lastTriggerElementRef.current = el
    closeReasonRef.current = null
    setSpeakerPopover({ segmentId, speakerId, anchorMeasurable, triggerElement: el })
  }, [])

  const fallbackAnchor = useMemo<Measurable>(() => ({
    getBoundingClientRect: () => new DOMRect(),
  }), [])

  const anchorRef = useRef<Measurable>(fallbackAnchor)

  useEffect(() => {
    if (speakerPopover?.anchorMeasurable) {
      anchorRef.current = speakerPopover.anchorMeasurable
    }
    if (speakerPopover?.triggerElement) {
      lastTriggerElementRef.current = speakerPopover.triggerElement
    }
  }, [speakerPopover])

  const closeSpeakerPopover = useCallback((reason: SpeakerPopoverCloseReason = 'dismiss') => {
    closeReasonRef.current = reason
    setSpeakerPopover(null)
  }, [])

  const handleSelectSpeaker = useCallback(async (speaker: Speaker) => {
    if (!speakerPopover) return
    const { segmentId } = speakerPopover
    const expectedSpeakerId = currentSpeakerIdOf(segmentId)

    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, speaker_id: speaker.id } : s))
    closeSpeakerPopover('selection')

    try {
      await reassignSegments(transcriptId, [
        { segment_id: segmentId, expected_speaker_id: expectedSpeakerId, speaker_id: speaker.id },
      ])
    } catch (err) {
      // Refused as stale or failed outright: show what the database holds. If
      // that cannot be read either, at least undo the change that never saved.
      console.error('Failed to reassign speaker:', err)
      if (!(await reloadSpeakerAssignments())) {
        setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, speaker_id: expectedSpeakerId } : s))
      }
    }
  }, [closeSpeakerPopover, currentSpeakerIdOf, speakerPopover, reloadSpeakerAssignments, setSegments, transcriptId])

  const handleCreateSpeaker = useCallback(async (label: string) => {
    if (!speakerPopover) return
    const { segmentId } = speakerPopover
    const expectedSpeakerId = currentSpeakerIdOf(segmentId)

    closeSpeakerPopover('selection')

    try {
      // One atomic call: a failed move never leaves an orphan speaker behind.
      const createdSpeaker = await assignSegmentsToNewSpeaker(transcriptId, label, [
        { segment_id: segmentId, expected_speaker_id: expectedSpeakerId },
      ])

      setSpeakers(prev => [...prev, createdSpeaker])
      setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, speaker_id: createdSpeaker.id } : s))
    } catch (err) {
      console.error('Failed to create speaker:', err)
      await reloadSpeakerAssignments()
    }
  }, [closeSpeakerPopover, currentSpeakerIdOf, speakerPopover, reloadSpeakerAssignments, transcriptId, setSpeakers, setSegments])

  // Sets the transcript-local label; null clears it back to `Speaker {ordinal}`.
  const saveCustomLabel = useCallback(async (speaker: Speaker, customLabel: string | null) => {
    setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, custom_label: customLabel } : sp))
    closeSpeakerPopover('selection')

    try {
      const saved = await setSpeakerCustomLabel(speaker.id, speaker.custom_label, customLabel)
      setSpeakers(prev => prev.map(sp => sp.id === saved.id ? saved : sp))
    } catch (err) {
      // Prefer the label the database now holds (another tab may have renamed
      // it); fall back to the old label only if that cannot be read.
      console.error('Failed to rename speaker:', err)
      if (!(await reloadSpeakerAssignments())) {
        setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, custom_label: speaker.custom_label } : sp))
      }
    }
  }, [closeSpeakerPopover, reloadSpeakerAssignments, setSpeakers])

  const handleRenameSpeaker = useCallback(
    (speaker: Speaker, newLabel: string) => saveCustomLabel(speaker, newLabel),
    [saveCustomLabel]
  )

  const handleUntag = useCallback(
    (speaker: Speaker) => saveCustomLabel(speaker, null),
    [saveCustomLabel]
  )

  return {
    speakerPopover, setSpeakerPopover,
    closeSpeakerPopover,
    closeReasonRef,
    lastTriggerElementRef,
    anchorRef,
    speakersMap,
    speakerColorMap,
    colorForSpeaker,
    labelForSpeaker,
    handleAvatarClick,
    handleSelectSpeaker,
    handleCreateSpeaker,
    handleRenameSpeaker,
    handleUntag,
  }
}
