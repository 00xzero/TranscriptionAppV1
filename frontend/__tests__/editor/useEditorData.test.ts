import { chooseEditorDuration, mergeSpeakerAssignments } from '@/app/editor/[id]/hooks/useEditorData'
import type { Seg } from '@/app/editor/[id]/types'

describe('chooseEditorDuration', () => {
  it('uses the longer waveform duration when transcript metadata under-reports app-recorded media', () => {
    expect(chooseEditorDuration(67, 78)).toBe(78)
  })

  it('falls back to transcript duration when no waveform duration is available', () => {
    expect(chooseEditorDuration(67, null)).toBe(67)
  })

  it('ignores invalid duration values', () => {
    expect(chooseEditorDuration(null, Number.POSITIVE_INFINITY)).toBeNull()
    expect(chooseEditorDuration(0, -1)).toBeNull()
  })
})

describe('mergeSpeakerAssignments', () => {
  const seg = (id: string, speaker_id: string | null, text: string): Seg => ({
    id, transcript_id: 't1', speaker_id, start_ms: 0, end_ms: 1000, text,
    is_edited: false, is_filler: false, algo_version: 'test',
    created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z',
  })

  it('takes speaker assignments from the database and keeps unsaved text', () => {
    const current = [seg('s1', 'a', 'edited, not saved yet'), seg('s2', 'b', 'two')]
    const fetched = [
      { id: 's1', speaker_id: 'c', text: 'old text in the database' },
      { id: 's2', speaker_id: null, text: 'two' },
    ]

    const merged = mergeSpeakerAssignments(current, fetched)

    expect(merged.map((s) => [s.speaker_id, s.text])).toEqual([
      ['c', 'edited, not saved yet'],
      [null, 'two'],
    ])
  })

  it('leaves a segment the fetch did not return untouched', () => {
    const current = [seg('s1', 'a', 'one')]
    expect(mergeSpeakerAssignments(current, [])[0]).toBe(current[0])
  })
})
