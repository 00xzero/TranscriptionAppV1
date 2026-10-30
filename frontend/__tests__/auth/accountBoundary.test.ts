/** @jest-environment node */

import { getAccountChangeError } from '@/lib/auth/account-boundary.server'
import {
  ACCOUNT_CHANGED_CODE, ACCOUNT_CHANGED_MESSAGE, AccountChangedError, EXPECTED_USER_HEADER, isAccountChangedError,
} from '@/lib/auth/account-boundary'
import { DeleteProjectErrorSchema, DeleteTranscriptErrorSchema } from '@/contracts/api'

test.each([null, '', 'b'])('a missing, empty or different expected owner is rejected (%s)', (expected) => {
  const headers = new Headers()
  if (expected !== null) headers.set(EXPECTED_USER_HEADER, expected)
  const error = getAccountChangeError(new Request('http://localhost/api/transcripts', { headers }), 'a')
  expect(error).toEqual({ error: ACCOUNT_CHANGED_MESSAGE, code: ACCOUNT_CHANGED_CODE })
  expect(DeleteTranscriptErrorSchema.parse(error)).toEqual(error)
  expect(DeleteProjectErrorSchema.parse({ ...error, stage: 'begin' })).toEqual({ ...error, stage: 'begin' })
})

test('the authenticated owner must exactly match the expectation', () => {
  const request = new Request('http://localhost/api/transcripts', { headers: { [EXPECTED_USER_HEADER]: 'a' } })
  expect(getAccountChangeError(request, 'a')).toBeNull()
})

test('the generic message identifies direct and wrapped account changes', () => {
  expect(ACCOUNT_CHANGED_MESSAGE).toBe('Your account changed in another tab. Switch back to the original account and try again.')
  expect(isAccountChangedError(new AccountChangedError())).toBe(true)
  expect(isAccountChangedError(new Error(`Upload failed: ${ACCOUNT_CHANGED_MESSAGE}`))).toBe(true)
  expect(isAccountChangedError(new Error('Network unavailable'))).toBe(false)
  expect(isAccountChangedError(null)).toBe(false)
})
