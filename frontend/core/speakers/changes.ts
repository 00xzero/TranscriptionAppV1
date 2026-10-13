import type { NewSpeakerSegmentChange, Segment, SegmentSpeakerChange } from '@/contracts/db'

/** A change to a segment's speaker, expecting the speaker and revision it has now. */
export const speakerChangeFrom = (segment: Pick<Segment, 'id' | 'speaker_id' | 'revision'>): NewSpeakerSegmentChange => ({
  segment_id: segment.id,
  expected_speaker_id: segment.speaker_id,
  expected_revision: segment.revision,
})

/**
 * The change that undoes `change`: the segment goes back to the speaker it
 * had. A speaker write leaves the segment's revision as it was, so the undo
 * expects the same one; a split or rejoin since refuses it.
 */
export const reverseSpeakerChange = (change: SegmentSpeakerChange): SegmentSpeakerChange => ({
  segment_id: change.segment_id,
  expected_speaker_id: change.speaker_id,
  expected_revision: change.expected_revision,
  speaker_id: change.expected_speaker_id,
})
