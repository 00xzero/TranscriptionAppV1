import type { Seg } from '@/app/(app)/editor/[id]/types'
import type { Speaker } from '@/contracts/db'

/**
 * A long transcript for render-cost tests: by default 5,000 segments of 20
 * words each (100,000 words) over 10 hours, four speakers taking turns of a
 * few segments. Ids are valid UUIDs, so every schema check passes as it would
 * for a real transcript.
 */
export const LONG_TRANSCRIPT_ID = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-0000000000aa'

const uuid = (kind: number, n: number) =>
  `00000000-0000-4000-8${kind.toString(16).padStart(3, '0')}-${n.toString(16).padStart(12, '0')}`

// "the" is common, as in real speech: Replace All on it changes most segments.
const VOCABULARY = [
  'the', 'meeting', 'we', 'agreed', 'that', 'budget', 'for', 'next', 'quarter', 'should',
  'cover', 'the', 'new', 'hires', 'and', 'travel', 'so', 'let', 'us', 'review',
  'numbers', 'again', 'on', 'Thursday', 'with', 'finance', 'team', 'before', 'the', 'board',
]

export type LongTranscript = {
  segments: Seg[]
  speakers: Speaker[]
  /** Word rows grouped per segment, as `fetchSegmentWordSets` returns them. */
  wordSets: { id: string; revision: number; words: unknown[] }[]
  durationSecs: number
}

export function makeLongTranscript({ segmentCount = 5000, wordsPerSegment = 20, durationSecs = 36000 } = {}): LongTranscript {
  const at = '2026-11-01T00:00:00Z'
  const speakers: Speaker[] = [0, 1, 2, 3].map((i) => ({
    id: uuid(1, i + 1),
    transcript_id: LONG_TRANSCRIPT_ID,
    user_id: USER_ID,
    ordinal: i + 1,
    custom_label: null,
    diarization_index: i,
    person_id: null,
    created_at: at,
    updated_at: at,
  }))
  const segMs = Math.floor((durationSecs * 1000) / segmentCount)
  const wordMs = Math.floor(segMs / wordsPerSegment)
  const segments: Seg[] = []
  const wordSets: LongTranscript['wordSets'] = []
  for (let s = 0; s < segmentCount; s++) {
    const id = uuid(2, s + 1)
    const start = s * segMs
    // Turns of three segments, rotating through the speakers.
    const speaker = speakers[Math.floor(s / 3) % speakers.length]
    const words = Array.from({ length: wordsPerSegment }, (_, w) => {
      const text = VOCABULARY[(s * 7 + w) % VOCABULARY.length]
      return {
        id: uuid(3, s * wordsPerSegment + w + 1),
        segment_id: id,
        start_ms: start + w * wordMs,
        end_ms: start + (w + 1) * wordMs - 10,
        text,
        punctuated_text: w === wordsPerSegment - 1 ? `${text}.` : text,
        order_index: w,
      }
    })
    segments.push({
      id,
      transcript_id: LONG_TRANSCRIPT_ID,
      speaker_id: speaker.id,
      diarization_index: speaker.diarization_index,
      start_ms: start,
      end_ms: start + segMs,
      text: words.map((w) => w.punctuated_text).join(' '),
      is_edited: false,
      is_filler: false,
      algo_version: 'test',
      revision: 0,
      created_at: at,
      updated_at: at,
    })
    wordSets.push({ id, revision: 0, words })
  }
  return { segments, speakers, wordSets, durationSecs }
}
