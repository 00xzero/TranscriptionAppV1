/** @jest-environment node */

import { TRANSCRIPTION_ENGINES } from '@/contracts/transcription-options'
import {
  ENGINE_CAPABILITIES,
  engineLengthRefusal,
  fillerWordsAlwaysKept,
  fillerWordsApply,
  profanityMaskingApplies,
  storedFillerWords,
  storedProfanityMasking,
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
    expect(fillerWordsAlwaysKept('soniox', 'en')).toBe(false)
    expect(profanityMaskingApplies('soniox', 'en')).toBe(false)
    expect(profanityMaskingApplies('deepgram', 'en')).toBe(true)
    expect(profanityMaskingApplies('deepgram', 'ru')).toBe(true)
  })

  test('AssemblyAI always keeps filler words, and masks profanity in every language but Russian', () => {
    for (const language of ['en', 'es', 'ja', 'ru', 'multi'] as const) {
      expect(fillerWordsAlwaysKept('assemblyai', language)).toBe(true)
      expect(fillerWordsApply('assemblyai', language)).toBe(false)
    }
    expect(profanityMaskingApplies('assemblyai', 'en')).toBe(true)
    expect(profanityMaskingApplies('assemblyai', 'multi')).toBe(true)
    expect(profanityMaskingApplies('assemblyai', 'ru')).toBe(false)
  })

  test('AssemblyAI takes up to ten hours', () => {
    expect(engineLengthRefusal('assemblyai', 10 * 3600)).toBeNull()
    expect(engineLengthRefusal('assemblyai', 10 * 3600 + 1)).toBe(
      'AssemblyAI Universal-3.5 Pro accepts audio up to 10 h; this file is 10 h 1 min. Upload it again and choose Deepgram Nova-3.'
    )
  })

  test('records filler words and masking as the engine will really do them', () => {
    const base = { detect_speakers: true, keep_filler_words: true, mask_profanity: true } as const
    // Deepgram: a choice in English, off elsewhere.
    expect(storedFillerWords({ ...base, engine: 'deepgram', language: 'en' })).toBe(true)
    expect(storedFillerWords({ ...base, engine: 'deepgram', language: 'en', keep_filler_words: false })).toBe(false)
    expect(storedFillerWords({ ...base, engine: 'deepgram', language: 'es' })).toBe(false)
    expect(storedProfanityMasking({ ...base, engine: 'deepgram', language: 'es' })).toBe(true)
    // Soniox: neither, whatever the switches were left at.
    expect(storedFillerWords({ ...base, engine: 'soniox', language: 'en' })).toBe(false)
    expect(storedProfanityMasking({ ...base, engine: 'soniox', language: 'en' })).toBe(false)
    // AssemblyAI: fillers always, whatever the switch; masking except in Russian.
    expect(storedFillerWords({ ...base, engine: 'assemblyai', language: 'en', keep_filler_words: false })).toBe(true)
    expect(storedFillerWords({ ...base, engine: 'assemblyai', language: 'ru', keep_filler_words: false })).toBe(true)
    expect(storedProfanityMasking({ ...base, engine: 'assemblyai', language: 'en' })).toBe(true)
    expect(storedProfanityMasking({ ...base, engine: 'assemblyai', language: 'ru' })).toBe(false)
  })

  test('Soniox refuses audio over five hours, with the length in words', () => {
    expect(engineLengthRefusal('soniox', 5 * 3600)).toBeNull()
    expect(engineLengthRefusal('soniox', 5 * 3600 + 1)).toBe(
      'Soniox v5 accepts audio up to 5 h; this file is 5 h 1 min. Upload it again and choose Deepgram Nova-3 or AssemblyAI Universal-3.5 Pro.'
    )
    expect(engineLengthRefusal('soniox', 6 * 3600 + 12 * 60 + 30)).toContain('this file is 6 h 13 min')
    expect(engineLengthRefusal('deepgram', 24 * 3600)).toBeNull()
  })
})
