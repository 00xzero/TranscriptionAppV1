import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  updateSegment,
  createSpeaker,
  updateSpeaker,
  deleteSpeaker,
} from '@/lib/supabase/queries'
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
  setSpeakers,
  setSegments,
  reloadTranscript,
}: {
  transcriptId: string
  speakers: Speaker[]
  setSpeakers: React.Dispatch<React.SetStateAction<Speaker[]>>
  setSegments: React.Dispatch<React.SetStateAction<Seg[]>>
  reloadTranscript: () => Promise<void>
}) {
  const [speakerPopover, setSpeakerPopover] = useState<SpeakerPopoverState | null>(null)
  const lastTriggerElementRef = useRef<HTMLElement | null>(null)
  const closeReasonRef = useRef<SpeakerPopoverCloseReason | null>(null)

  const speakersMap = useMemo(() => {
    const m = new Map<string, Speaker>()
    speakers.forEach((sp) => m.set(sp.id, sp))
    return m
  }, [speakers])

  const speakerColorPalette = useMemo(() => [
    '#4F638C', '#C73E1D', '#CA8A04',
    '#0D9488', '#7C3AED', '#64748B',
    '#B45309', '#059669', '#DB2777', '#2563EB',
  ], [])

  const speakerColorMap = useMemo(() => {
    const map = new Map<string, string>()
    speakers.forEach((sp, idx) => {
      if (sp.color) {
        map.set(sp.id, sp.color)
      } else {
        map.set(sp.id, speakerColorPalette[idx % speakerColorPalette.length])
      }
    })
    return map
  }, [speakers, speakerColorPalette])

  const colorForSpeaker = useCallback((sp?: Speaker) => {
    if (!sp) return '#9CA3AF'
    if (sp.color) return sp.color
    return speakerColorMap.get(sp.id) || '#9CA3AF'
  }, [speakerColorMap])

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

    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, speaker_id: speaker.id } : s))
    closeSpeakerPopover('selection')

    try {
      await updateSegment(segmentId, { speaker_id: speaker.id })
    } catch (err) {
      console.error('Failed to reassign speaker:', err)
      await reloadTranscript()
    }
  }, [closeSpeakerPopover, speakerPopover, reloadTranscript, setSegments])

  const handleCreateSpeaker = useCallback(async (label: string) => {
    if (!speakerPopover) return
    const { segmentId } = speakerPopover

    closeSpeakerPopover('selection')

    let newSpeaker: Speaker | null = null

    try {
      const createdSpeaker = await createSpeaker(transcriptId, label)
      newSpeaker = createdSpeaker

      await updateSegment(segmentId, { speaker_id: createdSpeaker.id })

      setSpeakers(prev => [...prev, createdSpeaker])
      setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, speaker_id: createdSpeaker.id } : s))
    } catch (err) {
      console.error('Failed to create speaker:', err)
      if (newSpeaker) {
        try {
          await deleteSpeaker(newSpeaker.id)
        } catch (cleanupErr) {
          console.error('Failed to cleanup orphan speaker:', cleanupErr)
        }
      }
    }
  }, [closeSpeakerPopover, speakerPopover, transcriptId, setSpeakers, setSegments])

  const handleRenameSpeaker = useCallback(async (speaker: Speaker, newLabel: string) => {
    setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: newLabel } : sp))
    closeSpeakerPopover('selection')

    try {
      await updateSpeaker(speaker.id, { label: newLabel })
    } catch (err) {
      console.error('Failed to rename speaker:', err)
      setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: speaker.label } : sp))
    }
  }, [closeSpeakerPopover, setSpeakers])

  const handleUntag = useCallback(async (speaker: Speaker) => {
    const existingNumbers = speakers
      .map(sp => {
        const match = sp.label.match(/^Speaker\s+(\d+)$/i)
        return match ? parseInt(match[1], 10) : -1
      })
      .filter(n => n >= 0)
    const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 0
    const newLabel = `Speaker ${nextNumber}`

    setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: newLabel } : sp))
    closeSpeakerPopover('selection')

    try {
      await updateSpeaker(speaker.id, { label: newLabel })
    } catch (err) {
      console.error('Failed to untag speaker:', err)
      setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: speaker.label } : sp))
    }
  }, [closeSpeakerPopover, speakers, setSpeakers])

  return {
    speakerPopover, setSpeakerPopover,
    closeSpeakerPopover,
    closeReasonRef,
    lastTriggerElementRef,
    anchorRef,
    speakersMap,
    speakerColorPalette,
    speakerColorMap,
    colorForSpeaker,
    handleAvatarClick,
    handleSelectSpeaker,
    handleCreateSpeaker,
    handleRenameSpeaker,
    handleUntag,
  }
}
