/** @jest-environment node */

import { TRANSCRIPTION_ENGINES } from '@/contracts/transcription-options'
import {
  ENGINE_CAPABILITIES,
  engineLengthRefusal,
  fillerWordsApply,
  profanityMaskingApplies,
} from '@/core/transcription/engines/capabilities'
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

  test('Soniox keeps no filler words and masks no profanity', () => {
    expect(fillerWordsApply('soniox', 'en')).toBe(false)
    expect(profanityMaskingApplies('soniox')).toBe(false)
    expect(profanityMaskingApplies('deepgram')).toBe(true)
  })

  test('Soniox refuses audio over five hours, with the length in words', () => {
    expect(engineLengthRefusal('soniox', 5 * 3600)).toBeNull()
    expect(engineLengthRefusal('soniox', 5 * 3600 + 1)).toBe(
      'Soniox v5 accepts audio up to 5 h; this file is 5 h 1 min. Choose Deepgram Nova-3 for longer files.'
    )
    expect(engineLengthRefusal('soniox', 6 * 3600 + 12 * 60 + 30)).toContain('this file is 6 h 13 min')
    expect(engineLengthRefusal('deepgram', 24 * 3600)).toBeNull()
  })
})
