/** @jest-environment node */

import { classifyError } from '@/core/transcription/errors'

describe('classifyError', () => {
  test("Soniox's context-too-large refusal is a key-term error", () => {
    expect(classifyError('Soniox API error: 400 - {"error_type":"invalid_request","message":"Context is too long"}')).toEqual({
      type: 'keyterm_error',
      message: 'Too many key terms for Soniox. Please use fewer or shorter terms.',
    })
  })

  test('other Soniox errors stay general', () => {
    expect(classifyError('Soniox API error: 503 - unavailable').type).toBe('transcription_error')
  })

  test("Deepgram's key-term limit is still recognised", () => {
    expect(classifyError('keyterm limit exceeded').type).toBe('keyterm_error')
  })
})
