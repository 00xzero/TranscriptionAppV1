import { displayedIdentityKey, type SpeakerPresentation } from './labels'

/**
 * Who talked how much, and when, in one transcript. The editor's speaker
 * summary and sidebar read this; it groups by displayed identity, so a person
 * with two voices is one entry, and unassigned segments are one Unknown entry.
 */

export type TalkSegment = {
  id: string
  speaker_id: string | null
  start_ms: number
  end_ms: number
  text: string
}

/** A run of consecutive segments under one identity: what the editor shows under one header. */
export type SpeakerTurn = {
  /** The turn's first segment: where a jump lands. */
  segmentId: string
  segmentIds: readonly string[]
  startMs: number
  /** The turn's opening words, for a preview. */
  excerpt: string
}

export type SpeakerTalk = {
  key: string
  /** Transcript speakers shown as this identity, in order of first appearance. */
  speakerIds: readonly (string | null)[]
  speakingMs: number
  /** Fraction of all segment time, 0–1. Zero for every identity when there is no time at all. */
  share: number
  turns: readonly SpeakerTurn[]
}

export type TalkSummary = {
  totalMs: number
  /** Most speaking time first. */
  identities: readonly SpeakerTalk[]
}

/** Long enough to recognise a turn by; the UI clamps it further. */
const EXCERPT_CHARS = 240

export function summariseSpeakers(
  segments: readonly TalkSegment[],
  presentation: Pick<SpeakerPresentation, 'identityKeys'>
): TalkSummary {
  type BuildingTurn = { segmentId: string; segmentIds: string[]; startMs: number; excerpt: string }
  type Building = { key: string; speakerIds: (string | null)[]; speakingMs: number; turns: BuildingTurn[]; order: number }
  const byKey = new Map<string, Building>()
  let totalMs = 0
  let previousKey: string | null = null
  let turn: BuildingTurn | null = null

  for (const segment of segments) {
    const key = displayedIdentityKey(presentation, segment.speaker_id)
    let entry = byKey.get(key)
    if (!entry) {
      entry = { key, speakerIds: [], speakingMs: 0, turns: [], order: byKey.size }
      byKey.set(key, entry)
    }
    if (!entry.speakerIds.includes(segment.speaker_id)) entry.speakerIds.push(segment.speaker_id)

    // Timestamps come from the transcriber; a segment that ends before it starts counts as none.
    const length = Math.max(0, segment.end_ms - segment.start_ms)
    entry.speakingMs += length
    totalMs += length

    if (key !== previousKey || !turn) {
      turn = { segmentId: segment.id, segmentIds: [], startMs: segment.start_ms, excerpt: '' }
      entry.turns.push(turn)
    }
    turn.segmentIds.push(segment.id)
    const text = segment.text.trim()
    if (text && turn.excerpt.length < EXCERPT_CHARS) {
      turn.excerpt = (turn.excerpt ? `${turn.excerpt} ${text}` : text).slice(0, EXCERPT_CHARS)
    }
    previousKey = key
  }

  const identities = [...byKey.values()]
    // Ties keep transcript order, so the list does not shuffle between equal speakers.
    .sort((a, b) => b.speakingMs - a.speakingMs || a.order - b.order)
    .map(({ key, speakerIds, speakingMs, turns }) => ({
      key,
      speakerIds,
      speakingMs,
      share: totalMs > 0 ? speakingMs / totalMs : 0,
      turns,
    }))
  return { totalMs, identities }
}
