import type { ProjectVoicePeer } from '@/contracts/db'
import { previewDisplay, voiceDisplay } from '@/lib/speakers/display'
import { SPEAKER_COLOR_FALLBACK } from '@/lib/speakers/palette'

const peer = (overrides: Partial<ProjectVoicePeer> & { id: string; ordinal: number }): ProjectVoicePeer => ({
  customLabel: null, personId: null, personName: null, organisationName: null, ...overrides,
})

describe('voiceDisplay', () => {
  test('a generic voice reads as the editor shows it, in grey', () => {
    const peers = [peer({ id: 'v1', ordinal: 3 })]
    expect(voiceDisplay(peers, 'v1')).toEqual({ label: 'Speaker 3', avatarText: 'S3', color: SPEAKER_COLOR_FALLBACK })
  })

  test('a labelled voice beside a namesake person is told apart, as in the editor', () => {
    const peers = [
      peer({ id: 'p1', ordinal: 4, personId: 'person', personName: 'Paul' }),
      peer({ id: 'v1', ordinal: 1, customLabel: 'Paul' }),
    ]
    const voice = voiceDisplay(peers, 'v1')
    expect(voice.label).toBe('Paul (2)')
    expect(voice.avatarText).toBe('P')
  })

  test('the project avatar of a voice uses the same label, with its transcript', () => {
    const peers = [peer({ id: 'v1', ordinal: 2 })]
    expect(previewDisplay({ kind: 'voice', id: 'v1', transcriptId: 't1', transcriptTitle: 'Q3 steering', peers }))
      .toEqual({ key: 'voice:v1', tooltip: 'Speaker 2 · Q3 steering', avatarText: 'S2', color: SPEAKER_COLOR_FALLBACK })
  })
})
