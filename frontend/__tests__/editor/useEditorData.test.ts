import { chooseEditorDuration } from '@/app/editor/[id]/hooks/useEditorData'

describe('chooseEditorDuration', () => {
  it('uses the longer waveform duration when project metadata under-reports app-recorded media', () => {
    expect(chooseEditorDuration(67, 78)).toBe(78)
  })

  it('falls back to project duration when no waveform duration is available', () => {
    expect(chooseEditorDuration(67, null)).toBe(67)
  })

  it('ignores invalid duration values', () => {
    expect(chooseEditorDuration(null, Number.POSITIVE_INFINITY)).toBeNull()
    expect(chooseEditorDuration(0, -1)).toBeNull()
  })
})
