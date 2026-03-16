import { useCallback, useMemo, useState } from 'react'
import {
  updateChunk,
  updateSegment,
  createSpeaker,
  updateSpeaker,
  deleteSpeaker,
} from '@/lib/supabase/queries'
import type { Seg, Speaker } from '../types'

export function useSpeakerAssignments({
  projectId,
  speakers,
  setSpeakers,
  segments,
  setSegments,
  source,
  reloadTranscript,
}: {
  projectId: string
  speakers: Speaker[]
  setSpeakers: React.Dispatch<React.SetStateAction<Speaker[]>>
  segments: Seg[]
  setSegments: React.Dispatch<React.SetStateAction<Seg[]>>
  source: 'chunks' | 'segments'
  reloadTranscript: () => Promise<void>
}) {
  const [speakerPopover, setSpeakerPopover] = useState<{ chunkId: string; speakerId: string | null; anchorRect: DOMRect } | null>(null)

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

  const handleAvatarClick = useCallback((e: React.MouseEvent, chunkId: string, speakerId: string | null) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setSpeakerPopover({ chunkId, speakerId, anchorRect: rect })
  }, [])

  const handleSelectSpeaker = useCallback(async (speaker: Speaker) => {
    if (!speakerPopover) return
    const { chunkId } = speakerPopover

    setSegments(prev => prev.map(s => s.id === chunkId ? { ...s, speaker_id: speaker.id } : s))
    setSpeakerPopover(null)

    try {
      if (source === 'segments') {
        await updateSegment(chunkId, { speaker_id: speaker.id })
      } else {
        await updateChunk(chunkId, { speaker_id: speaker.id })
      }
    } catch (err) {
      console.error('Failed to reassign speaker:', err)
      await reloadTranscript()
    }
  }, [speakerPopover, reloadTranscript, source, setSegments])

  const handleCreateSpeaker = useCallback(async (label: string) => {
    if (!speakerPopover) return
    const { chunkId } = speakerPopover

    setSpeakerPopover(null)

    let newSpeaker: Speaker | null = null

    try {
      const createdSpeaker = await createSpeaker(projectId, label)
      newSpeaker = createdSpeaker

      if (source === 'segments') {
        await updateSegment(chunkId, { speaker_id: createdSpeaker.id })
      } else {
        await updateChunk(chunkId, { speaker_id: createdSpeaker.id })
      }

      setSpeakers(prev => [...prev, createdSpeaker])
      setSegments(prev => prev.map(s => s.id === chunkId ? { ...s, speaker_id: createdSpeaker.id } : s))
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
  }, [speakerPopover, projectId, source, setSpeakers, setSegments])

  const handleRenameSpeaker = useCallback(async (speaker: Speaker, newLabel: string) => {
    setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: newLabel } : sp))
    setSpeakerPopover(null)

    try {
      await updateSpeaker(speaker.id, { label: newLabel })
    } catch (err) {
      console.error('Failed to rename speaker:', err)
      setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: speaker.label } : sp))
    }
  }, [setSpeakers])

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
    setSpeakerPopover(null)

    try {
      await updateSpeaker(speaker.id, { label: newLabel })
    } catch (err) {
      console.error('Failed to untag speaker:', err)
      setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: speaker.label } : sp))
    }
  }, [speakers, setSpeakers])

  return {
    speakerPopover, setSpeakerPopover,
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
