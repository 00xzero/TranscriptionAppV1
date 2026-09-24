import type { Speaker } from '@/contracts/db'

/**
 * The one speaker label resolver (spec §3 rules 4–5). The editor, every export
 * and the project summaries take their speaker labels from here; nothing else
 * builds one.
 */

/** Shown for a segment with no speaker. Unknown is not a speaker. */
export const UNKNOWN_SPEAKER_LABEL = 'Unknown speaker'

export type LabelledSpeaker = Pick<Speaker, 'id' | 'ordinal' | 'custom_label'>

/** Resolved display label per transcript speaker id. */
export type SpeakerLabels = ReadonlyMap<string, string>

export function genericSpeakerLabel(ordinal: number): string {
  return `Speaker ${ordinal}`
}

/** A speaker's own label, before telling it apart from others in its transcript. */
export function speakerBaseLabel(ordinal: number, customLabel: string | null): string {
  return customLabel ?? genericSpeakerLabel(ordinal)
}

/**
 * Display labels for one transcript's speakers.
 *
 * Speakers whose labels are identical are numbered: the first keeps its label
 * and the rest become `Paul (2)`, `Paul (3)`. "First" is first appearance in
 * `segments`, which must be in transcript order; speakers with no segments
 * follow by ordinal. Equality is exact, so `Paul` and `paul` stay as they are.
 */
export function resolveSpeakerLabels(
  speakers: readonly LabelledSpeaker[],
  segments: readonly { speaker_id: string | null }[]
): SpeakerLabels {
  const byId = new Map(speakers.map((speaker) => [speaker.id, speaker]))

  const ordered: LabelledSpeaker[] = []
  const seen = new Set<string>()
  for (const segment of segments) {
    const speaker = segment.speaker_id ? byId.get(segment.speaker_id) : undefined
    if (!speaker || seen.has(speaker.id)) continue
    seen.add(speaker.id)
    ordered.push(speaker)
  }
  const unused = speakers
    .filter((speaker) => !seen.has(speaker.id))
    .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
  ordered.push(...unused)

  const baseLabels = new Set(ordered.map((speaker) => speakerBaseLabel(speaker.ordinal, speaker.custom_label)))
  const taken = new Set<string>()
  const nextNumber = new Map<string, number>()
  const labels = new Map<string, string>()

  for (const speaker of ordered) {
    const base = speakerBaseLabel(speaker.ordinal, speaker.custom_label)
    let label = base
    if (taken.has(base)) {
      // Skip numbers another speaker already shows as its own label.
      let n = nextNumber.get(base) ?? 2
      while (taken.has(`${base} (${n})`) || baseLabels.has(`${base} (${n})`)) n++
      label = `${base} (${n})`
      nextNumber.set(base, n + 1)
    }
    taken.add(label)
    labels.set(speaker.id, label)
  }

  return labels
}

/** The label for a segment's speaker id: Unknown when there is none. */
export function speakerLabelFor(labels: SpeakerLabels, speakerId: string | null | undefined): string {
  return (speakerId ? labels.get(speakerId) : undefined) ?? UNKNOWN_SPEAKER_LABEL
}
