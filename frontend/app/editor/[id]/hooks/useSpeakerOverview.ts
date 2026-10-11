import { useMemo } from 'react'
import { UNKNOWN_IDENTITY_KEY, type SpeakerPresentation } from '@/core/speakers/labels'
import { summariseSpeakers, type SpeakerTurn } from '@/core/speakers/talk'
import type { PreviewDisplay, SpeakerDisplay } from '@/lib/speakers/display'
import type { Seg, Speaker } from '../types'

/** One speaker as the header summary and the speakers sidebar show it. */
export type SpeakerOverviewRow = {
  key: string
  label: string
  color: string
  avatarText: string
  organisation: string | null
  /** A detected voice nobody has named or linked yet. Unknown is not "unnamed": it is no speaker. */
  unnamed: boolean
  isUnknown: boolean
  share: number
  /** `31%`, or `<1%` for someone who barely spoke. */
  shareLabel: string
  turns: readonly SpeakerTurn[]
  preview: PreviewDisplay
}

export type SpeakerOverview = {
  /** Most speaking time first; Unknown last. */
  rows: SpeakerOverviewRow[]
  /** The header's avatars: speakers by talk time, or Unknown alone when nobody else has spoken. */
  headerSpeakers: PreviewDisplay[]
  headerCount: number
  speakerCount: number
  unnamedCount: number
  /** What the turn timelines measure against; never waits for the audio to load. */
  timelineMs: number
}

export function formatShare(share: number): string {
  if (share <= 0) return '0%'
  const percent = Math.round(share * 100)
  return percent === 0 ? '<1%' : `${percent}%`
}

export function useSpeakerOverview({ segments, speakers, presentation, displayForSpeaker, durationSecs }: {
  segments: Seg[]
  speakers: Speaker[]
  presentation: SpeakerPresentation
  displayForSpeaker: (speakerId: string | null) => SpeakerDisplay
  durationSecs: number | null
}): SpeakerOverview {
  return useMemo(() => {
    const summary = summariseSpeakers(segments, presentation)
    const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]))

    const rows = summary.identities.map((identity): SpeakerOverviewRow => {
      const isUnknown = identity.key === UNKNOWN_IDENTITY_KEY
      // Every speaker under one identity shows the same label and colour.
      const display = displayForSpeaker(identity.speakerIds[0] ?? null)
      const unnamed = !isUnknown && identity.speakerIds.every((id) => {
        const speaker = id ? speakerById.get(id) : undefined
        return !speaker || (!speaker.person_id && !speaker.custom_label)
      })
      const shareLabel = formatShare(identity.share)
      return {
        key: identity.key,
        label: display.label,
        color: display.color,
        avatarText: display.avatarText,
        organisation: display.organisation,
        unnamed,
        isUnknown,
        share: identity.share,
        shareLabel,
        turns: identity.turns,
        preview: {
          key: identity.key,
          tooltip: [display.label, display.organisation, shareLabel].filter(Boolean).join(' · '),
          avatarText: display.avatarText,
          color: display.color,
        },
      }
    })
    // Unknown is not a speaker, so it closes the list whatever its share.
    rows.sort((a, b) => Number(a.isUnknown) - Number(b.isUnknown))

    const named = rows.filter((row) => !row.isUnknown)
    const header = named.length > 0 ? named : rows
    const lastEndMs = segments.reduce((max, segment) => Math.max(max, segment.end_ms), 0)
    return {
      rows,
      headerSpeakers: header.map((row) => row.preview),
      headerCount: header.length,
      speakerCount: named.length,
      unnamedCount: named.filter((row) => row.unnamed).length,
      timelineMs: Math.max((durationSecs ?? 0) * 1000, lastEndMs),
    }
  }, [segments, speakers, presentation, displayForSpeaker, durationSecs])
}
