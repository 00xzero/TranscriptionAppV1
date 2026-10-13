import type { SegmentSpeakerChange } from '@/contracts/db'

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
