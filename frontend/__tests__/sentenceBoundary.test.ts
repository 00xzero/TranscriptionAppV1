/** @jest-environment node */

import { isSentenceBoundary } from '@/core/transcript/text-utils'

describe('isSentenceBoundary', () => {
  test.each(['done.', 'really?', 'wow!', 'he said "yes"', 'done. '])('English %j ends a sentence, as before', (text) => {
    expect(isSentenceBoundary(text)).toBe(true)
  })

  test.each(['word', 'well,', 'so;', 'word.)', "it's"])('English %j does not, as before', (text) => {
    expect(isSentenceBoundary(text)).toBe(false)
  })

  test.each(['です。', 'でしょうか？', '楽しみです！', 'ﾃﾞｽ｡', '「行きます。」', '『本当？』', 'है।', 'इति॥'])(
    'Japanese and Hindi %j end a sentence',
    (text) => {
      expect(isSentenceBoundary(text)).toBe(true)
    }
  )

  test.each(['今日は、', '天気', 'हमारी'])('Japanese and Hindi %j do not', (text) => {
    expect(isSentenceBoundary(text)).toBe(false)
  })
})
