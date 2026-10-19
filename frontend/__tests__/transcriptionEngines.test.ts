/** @jest-environment node */

import { TRANSCRIPTION_ENGINES } from '@/contracts/transcription-options'
import { ENGINE_CAPABILITIES, fillerWordsApply } from '@/core/transcription/engines/capabilities'
import { getEngine } from '@/lib/transcription/engines.server'

describe('transcription engines', () => {
  test('every engine offered has an implementation and capabilities under its own name', () => {
    for (const id of TRANSCRIPTION_ENGINES) {
      expect(getEngine(id).id).toBe(id)
      expect(ENGINE_CAPABILITIES[id]).toBeDefined()
    }
  })

  test('refuses an engine that is not one of ours', () => {
    expect(() => getEngine('whisper')).toThrow('Unknown transcription engine: whisper')
    expect(() => getEngine(undefined)).toThrow('Unknown transcription engine: undefined')
  })

  test('Deepgram keeps filler words in English only', () => {
    expect(fillerWordsApply('deepgram', 'en')).toBe(true)
    expect(fillerWordsApply('deepgram', 'es')).toBe(false)
    expect(fillerWordsApply('deepgram', 'multi')).toBe(false)
  })
})
