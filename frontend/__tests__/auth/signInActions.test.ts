/** @jest-environment node */

import '../helpers/authEnv'
import { saveSession } from '@workos-inc/authkit-nextjs'
import { mockWorkOS } from '@/__mocks__/workos-authkit-nextjs'
import type { AuthActionResult } from '@/contracts/auth'
import { createCookieJar } from '../helpers/cookieJar'
import { makeAuthResponse, workosError } from '../helpers/workosFixtures'
import {
  requestPasswordReset,
  resendCode,
  resetPassword,
  signIn,
  signUp,
  verifyCode,
} from '@/app/auth/actions'
import { provisionAppUser } from '@/lib/auth/provision-app-user.server'
import { codeAttempts } from '@/lib/auth/attempt-cookies.server'

const mockJar = createCookieJar()
let mockIp = '203.0.113.1'
jest.mock('next/headers', () => ({
  cookies: async () => mockJar.jar,
  headers: async () => new Headers({ 'x-real-ip': mockIp, 'user-agent': 'TestBrowser/1.0' }),
}))
jest.mock('@/infra/supabase/admin', () => ({ createAdminClient: jest.fn(() => ({})) }))
jest.mock('@/lib/auth/provision-app-user.server', () => ({ provisionAppUser: jest.fn() }))

const um = mockWorkOS.userManagement as unknown as Record<string, jest.Mock>
const provision = provisionAppUser as jest.Mock
const save = saveSession as jest.Mock
const IDLE: AuthActionResult = { kind: 'idle' }

const AUTH = makeAuthResponse()
const verificationRequired = () =>
  workosError({
    name: 'AuthenticationException',
    status: 400,
    code: 'email_verification_required',
    pendingAuthenticationToken: 'pending-secret',
    rawData: { code: 'email_verification_required', email: 'ada@example.com', email_verification_id: 'email_verification_1' },
  })
const radarChallenge = () =>
  workosError({
    name: 'AuthenticationException',
    status: 400,
    code: 'radar_email_challenge',
    pendingAuthenticationToken: 'pending-radar',
    radarChallengeId: 'radar_challenge_1',
    rawData: { code: 'radar_email_challenge', user: { id: 'user_01A', email: 'ada@example.com' } },
  })

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}
const passwordForm = (extra: Record<string, string> = {}) =>
  form({ email: 'Ada@Example.com', password: 'correct horse battery', next: '/editor/abc', ...extra })

let ipCounter = 1
beforeEach(() => {
  jest.clearAllMocks()
  mockJar.clear()
  // Each test signs in from its own address, so the rate limit never carries over.
  mockIp = `203.0.113.${ipCounter++}`
  provision.mockResolvedValue('app-user-a')
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

async function startCode(error = verificationRequired()) {
  um.authenticateWithPassword.mockRejectedValueOnce(error)
  const result = await signIn(IDLE, passwordForm())
  if (result.kind !== 'code') throw new Error(`expected the code step, got ${JSON.stringify(result)}`)
  return result
}

const ACTIONS = [
  { name: 'signIn', action: signIn, invalidError: 'invalid_input' },
  { name: 'signUp', action: signUp, invalidError: 'invalid_input' },
  { name: 'verifyCode', action: verifyCode, invalidError: 'code_expired' },
  { name: 'resendCode', action: resendCode, invalidError: 'code_expired' },
  { name: 'requestPasswordReset', action: requestPasswordReset, invalidError: 'invalid_input' },
  { name: 'resetPassword', action: resetPassword, invalidError: 'invalid_input' },
]

describe.each(ACTIONS)('$name rate limit', ({ action, invalidError }) => {
  test('the shared bucket blocks before form reads, cookies or provider work', async () => {
    // Invalid submissions still consume exactly one attempt each, before validation.
    for (const attempt of [...ACTIONS, ...ACTIONS.slice(0, 4)]) {
      await expect(attempt.action(IDLE, new FormData())).resolves.toEqual({ kind: 'error', error: attempt.invalidError })
    }
    const data = new FormData()
    const readForm = jest.spyOn(data, 'get').mockImplementation(() => {
      throw new Error('A blocked action must not read the form')
    })
    const readAttempt = jest.spyOn(codeAttempts, 'read')
    const saveAttempt = jest.spyOn(codeAttempts, 'save')
    const clearAttempt = jest.spyOn(codeAttempts, 'clear')

    await expect(action(IDLE, data)).resolves.toEqual({ kind: 'error', error: 'blocked' })

    expect(readForm).not.toHaveBeenCalled()
    expect(readAttempt).not.toHaveBeenCalled()
    expect(saveAttempt).not.toHaveBeenCalled()
    expect(clearAttempt).not.toHaveBeenCalled()
    expect(mockJar.names()).toEqual([])
    for (const method of Object.values(um)) expect(method).not.toHaveBeenCalled()
    expect(provision).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  test('an empty visitor IP bypasses the limit without bypassing input validation', async () => {
    mockIp = ''
    for (let i = 0; i < 11; i++) {
      await expect(action(IDLE, new FormData())).resolves.toEqual({ kind: 'error', error: invalidError })
    }
    for (const method of Object.values(um)) expect(method).not.toHaveBeenCalled()
    expect(mockJar.names()).toEqual([])
  })
})

describe('signIn', () => {
  test('a right password provisions, then saves the session, then hands back /auth/finish (no redirect)', async () => {
    um.authenticateWithPassword.mockResolvedValue(AUTH)

    const result = await signIn(IDLE, passwordForm({ signalsId: 'radar-token' }))

    expect(result).toEqual({ kind: 'finish', url: 'http://localhost:3000/auth/finish?to=%2Feditor%2Fabc' })
    expect(um.authenticateWithPassword).toHaveBeenCalledWith({
      clientId: 'client_test',
      email: 'ada@example.com',
      password: 'correct horse battery',
      signalsId: 'radar-token',
      ipAddress: mockIp,
      userAgent: 'TestBrowser/1.0',
    })
    expect(provision).toHaveBeenCalledWith(expect.anything(), { id: 'user_01A', email: 'ada@example.com' })
    expect(save).toHaveBeenCalledWith(AUTH, 'http://localhost:3000/auth/callback')
    expect(provision.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0])
  })

  test('signs in without a Radar token when the page could not get one', async () => {
    um.authenticateWithPassword.mockResolvedValue(AUTH)

    await signIn(IDLE, passwordForm({ signalsId: '' }))

    expect(um.authenticateWithPassword.mock.calls[0][0].signalsId).toBeUndefined()
  })

  test('a wrong password says so, never with WorkOS’s own message', async () => {
    um.authenticateWithPassword.mockRejectedValue(
      workosError({ name: 'GenericServerException', status: 400, code: 'invalid_credentials', message: "Invalid credentials for 'ada@example.com'." })
    )

    await expect(signIn(IDLE, passwordForm())).resolves.toEqual({ kind: 'error', error: 'invalid_credentials' })
    expect(save).not.toHaveBeenCalled()
  })

  test('Radar’s block, and the account kinds we do not support, say so', async () => {
    um.authenticateWithPassword.mockRejectedValueOnce(workosError({ name: 'GenericServerException', status: 403, code: 'policy_denied' }))
    await expect(signIn(IDLE, passwordForm())).resolves.toEqual({ kind: 'error', error: 'blocked' })

    um.authenticateWithPassword.mockRejectedValueOnce(
      workosError({ name: 'AuthenticationException', status: 400, code: 'sso_required', rawData: { error: 'sso_required' } })
    )
    await expect(signIn(IDLE, passwordForm())).resolves.toEqual({ kind: 'error', error: 'unsupported' })
  })

  test('an unknown WorkOS failure is a temporary problem, not "can’t sign in here"', async () => {
    um.authenticateWithPassword.mockRejectedValue(workosError({ name: 'GenericServerException', status: 503, code: undefined }))

    await expect(signIn(IDLE, passwordForm())).resolves.toEqual({ kind: 'error', error: 'service' })
  })

  test('provisioning that fails once is retried, and the person goes straight on', async () => {
    um.authenticateWithPassword.mockResolvedValue(AUTH)
    provision.mockRejectedValueOnce(new Error('db blip'))

    await expect(signIn(IDLE, passwordForm())).resolves.toMatchObject({ kind: 'finish' })
    expect(provision).toHaveBeenCalledTimes(2)
  })

  test('provisioning that keeps failing writes no session, and the next sign-in can still succeed', async () => {
    um.authenticateWithPassword.mockResolvedValue(AUTH)
    provision.mockRejectedValue(new Error('db down'))

    await expect(signIn(IDLE, passwordForm())).resolves.toEqual({ kind: 'error', error: 'not_finished' })
    expect(provision).toHaveBeenCalledTimes(3)
    expect(save).not.toHaveBeenCalled()

    provision.mockResolvedValue('app-user-a')
    await expect(signIn(IDLE, passwordForm())).resolves.toMatchObject({ kind: 'finish' })
  })

  test('an unreadable form is refused before WorkOS is asked', async () => {
    await expect(signIn(IDLE, form({ email: 'not an email', password: 'x' }))).resolves.toEqual({
      kind: 'error',
      error: 'invalid_input',
    })
    expect(um.authenticateWithPassword).not.toHaveBeenCalled()
  })

  test('after ten tries a minute from one address, it stops asking WorkOS', async () => {
    um.authenticateWithPassword.mockRejectedValue(workosError({ name: 'GenericServerException', status: 400, code: 'invalid_credentials' }))
    for (let i = 0; i < 10; i++) await signIn(IDLE, passwordForm())

    await expect(signIn(IDLE, passwordForm())).resolves.toEqual({ kind: 'error', error: 'blocked' })
    expect(um.authenticateWithPassword).toHaveBeenCalledTimes(10)
  })
})

describe('the code step', () => {
  test('confirmation required opens it, keeping WorkOS’s pending token out of the answer', async () => {
    const result = await startCode()

    expect(result).toEqual({ kind: 'code', attempt: expect.any(String), challenge: 'email-verification', email: 'ada@example.com' })
    expect(JSON.stringify(result)).not.toContain('pending-secret')
    expect(mockJar.names()).toEqual([`olivetti-code-${result.attempt}`])
  })

  test('the right code signs in, spends the attempt and goes on to the destination', async () => {
    const { attempt } = await startCode()
    um.authenticateWithEmailVerification.mockResolvedValue(AUTH)

    const result = await verifyCode(IDLE, form({ attempt, code: '123456' }))

    expect(result).toEqual({ kind: 'finish', url: 'http://localhost:3000/auth/finish?to=%2Feditor%2Fabc' })
    expect(um.authenticateWithEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({ code: '123456', pendingAuthenticationToken: 'pending-secret' })
    )
    expect(mockJar.names()).toEqual([])
  })

  test('a wrong code keeps the attempt for another try; then the right one works', async () => {
    const { attempt } = await startCode()
    um.authenticateWithEmailVerification
      .mockRejectedValueOnce(workosError({ name: 'GenericServerException', status: 400, code: 'invalid_one_time_code' }))
      .mockResolvedValueOnce(AUTH)

    await expect(verifyCode(IDLE, form({ attempt, code: '000000' }))).resolves.toEqual({ kind: 'error', error: 'invalid_code' })
    expect(mockJar.names()).toEqual([`olivetti-code-${attempt}`])

    await expect(verifyCode(IDLE, form({ attempt, code: '123456' }))).resolves.toMatchObject({ kind: 'finish' })
  })

  test('a WorkOS outage keeps the attempt too', async () => {
    const { attempt } = await startCode()
    um.authenticateWithEmailVerification.mockRejectedValue(workosError({ name: 'GenericServerException', status: 502 }))

    await expect(verifyCode(IDLE, form({ attempt, code: '123456' }))).resolves.toEqual({ kind: 'error', error: 'service' })
    expect(mockJar.names()).toEqual([`olivetti-code-${attempt}`])
  })

  test('a token WorkOS says is spent clears the attempt: start again', async () => {
    const { attempt } = await startCode()
    um.authenticateWithEmailVerification.mockRejectedValue(
      workosError({ name: 'GenericServerException', status: 400, code: 'invalid_pending_authentication_token' })
    )

    await expect(verifyCode(IDLE, form({ attempt, code: '123456' }))).resolves.toEqual({ kind: 'error', error: 'code_expired' })
    expect(mockJar.names()).toEqual([])
  })

  test('an attempt that is gone (expired, or never ours) means start again', async () => {
    await expect(verifyCode(IDLE, form({ attempt: 'mabc1234-0123456789abcdef01234567', code: '123456' }))).resolves.toEqual({
      kind: 'error',
      error: 'code_expired',
    })
  })

  test('a further challenge returned while verifying opens its own step, with a new attempt', async () => {
    const { attempt } = await startCode()
    um.authenticateWithEmailVerification.mockRejectedValue(radarChallenge())

    const result = await verifyCode(IDLE, form({ attempt, code: '123456' }))

    expect(result).toMatchObject({ kind: 'code', challenge: 'radar' })
    expect(result.kind === 'code' && result.attempt).not.toBe(attempt)
    expect(mockJar.names()).toHaveLength(1)
  })

  test('signed in by the code, then provisioning fails: the attempt is spent and they sign in again', async () => {
    const { attempt } = await startCode()
    um.authenticateWithEmailVerification.mockResolvedValue(AUTH)
    provision.mockRejectedValue(new Error('db down'))

    await expect(verifyCode(IDLE, form({ attempt, code: '123456' }))).resolves.toEqual({ kind: 'error', error: 'not_finished' })
    expect(mockJar.names()).toEqual([])
    expect(save).not.toHaveBeenCalled()
  })

  test('a Radar challenge is finished with Radar’s own call', async () => {
    const { attempt, challenge } = await startCode(radarChallenge())
    um.authenticateWithRadarEmailChallenge.mockResolvedValue(AUTH)

    expect(challenge).toBe('radar')
    await expect(verifyCode(IDLE, form({ attempt, code: '654321' }))).resolves.toMatchObject({ kind: 'finish' })
    expect(um.authenticateWithRadarEmailChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ code: '654321', radarChallengeId: 'radar_challenge_1', pendingAuthenticationToken: 'pending-radar' })
    )
  })

  test('a new code is sent to the user WorkOS names, never one from the browser', async () => {
    const { attempt } = await startCode()
    um.getEmailVerification.mockResolvedValue({ id: 'email_verification_1', userId: 'user_01A', email: 'ada@example.com' })
    um.sendVerificationEmail.mockResolvedValue({})

    const result = await resendCode(IDLE, form({ attempt, userId: 'user_attacker' }))

    expect(result).toMatchObject({ kind: 'code', attempt, notice: 'code_sent' })
    expect(um.getEmailVerification).toHaveBeenCalledWith('email_verification_1')
    expect(um.sendVerificationEmail).toHaveBeenCalledWith({ userId: 'user_01A' })
  })

  test('a Radar challenge has no resend: start again instead', async () => {
    const { attempt } = await startCode(radarChallenge())

    await expect(resendCode(IDLE, form({ attempt }))).resolves.toEqual({ kind: 'error', error: 'code_expired' })
    expect(um.sendVerificationEmail).not.toHaveBeenCalled()
  })
})

describe('signUp', () => {
  test('passes Radar’s attempt id from the new account on to its first sign-in', async () => {
    um.createUser.mockResolvedValue({ id: 'user_01B', radarAuthAttemptId: 'radar_attempt_1' })
    um.authenticateWithPassword.mockRejectedValue(verificationRequired())

    const result = await signUp(IDLE, passwordForm({ signalsId: 'radar-token' }))

    expect(result).toMatchObject({ kind: 'code', challenge: 'email-verification' })
    expect(um.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com', signalsId: 'radar-token' }))
    expect(um.authenticateWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ radarAuthAttemptId: 'radar_attempt_1', signalsId: 'radar-token' })
    )
  })

  test('an account created whose first sign-in fails says the account is ready, not "email taken"', async () => {
    um.createUser.mockResolvedValue({ id: 'user_01B' })
    um.authenticateWithPassword.mockRejectedValue(workosError({ name: 'GenericServerException', status: 503 }))

    await expect(signUp(IDLE, passwordForm())).resolves.toEqual({ kind: 'notice', notice: 'account_created' })
  })

  test('a taken email and a weak password say so', async () => {
    um.createUser.mockRejectedValueOnce(
      workosError({ name: 'BadRequestException', status: 400, code: 'user_creation_error', errors: [{ code: 'email_not_available' }] })
    )
    await expect(signUp(IDLE, passwordForm())).resolves.toEqual({ kind: 'error', error: 'email_taken' })

    um.createUser.mockRejectedValueOnce(
      workosError({
        name: 'BadRequestException',
        status: 400,
        code: 'password_strength_error',
        errors: [{ code: 'password_too_short', message: 'Please try a password with 10 or more characters.' }],
      })
    )
    await expect(signUp(IDLE, passwordForm())).resolves.toEqual({
      kind: 'error',
      error: 'weak_password',
      detail: 'Please try a password with 10 or more characters.',
    })
    expect(um.authenticateWithPassword).not.toHaveBeenCalled()
  })
})

describe('password reset', () => {
  test('the answer never says whether the email has an account', async () => {
    um.createPasswordReset.mockResolvedValueOnce({})
    await expect(requestPasswordReset(IDLE, form({ email: 'ada@example.com' }))).resolves.toEqual({ kind: 'notice', notice: 'reset_sent' })

    um.createPasswordReset.mockRejectedValueOnce(workosError({ name: 'NotFoundException', status: 404, code: 'entity_not_found' }))
    await expect(requestPasswordReset(IDLE, form({ email: 'nobody@example.com' }))).resolves.toEqual({ kind: 'notice', notice: 'reset_sent' })
  })

  test('only a WorkOS outage is reported', async () => {
    um.createPasswordReset.mockRejectedValue(workosError({ name: 'GenericServerException', status: 500 }))

    await expect(requestPasswordReset(IDLE, form({ email: 'ada@example.com' }))).resolves.toEqual({ kind: 'error', error: 'service' })
  })

  test('a new password signs the person straight in', async () => {
    um.resetPassword.mockResolvedValue({ user: { id: 'user_01A', email: 'ada@example.com' } })
    um.authenticateWithPassword.mockResolvedValue(AUTH)

    const result = await resetPassword(IDLE, form({ token: 'reset-token', password: 'a brand new passphrase', next: '/' }))

    expect(result).toEqual({ kind: 'finish', url: 'http://localhost:3000/auth/finish?to=%2F' })
    expect(um.resetPassword).toHaveBeenCalledWith({ token: 'reset-token', newPassword: 'a brand new passphrase' })
    expect(um.authenticateWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com', password: 'a brand new passphrase' })
    )
  })

  test('a used or expired link says so', async () => {
    um.resetPassword.mockRejectedValue(workosError({ name: 'NotFoundException', status: 404, code: 'password_reset_token_not_found' }))

    await expect(resetPassword(IDLE, form({ token: 'old', password: 'a brand new passphrase' }))).resolves.toEqual({
      kind: 'error',
      error: 'reset_link',
    })
  })

  test('a weak new password says why, never "the link expired"', async () => {
    // As WorkOS answers it on a reset: its reset code, the reasons nested.
    um.resetPassword.mockRejectedValueOnce(
      workosError({
        name: 'BadRequestException',
        status: 400,
        code: 'password_reset_error',
        errors: [
          { code: 'password_too_short', message: 'Please try a password with 10 or more characters.' },
          { code: 'password_too_weak', message: 'Please try a stronger password.' },
        ],
      })
    )
    await expect(resetPassword(IDLE, form({ token: 'reset-token', password: 'short' }))).resolves.toEqual({
      kind: 'error',
      error: 'weak_password',
      detail: 'Please try a password with 10 or more characters.',
    })

    um.resetPassword.mockRejectedValueOnce(
      workosError({ name: 'BadRequestException', status: 400, code: 'password_reset_error', errors: [{ code: 'password_too_weak' }] })
    )
    await expect(resetPassword(IDLE, form({ token: 'reset-token', password: 'aaaaaaaaaaaa' }))).resolves.toEqual({
      kind: 'error',
      error: 'weak_password',
    })
  })

  test('a reset error without a password reason is still a dead link', async () => {
    um.resetPassword.mockRejectedValue(workosError({ name: 'BadRequestException', status: 400, code: 'password_reset_error' }))

    await expect(resetPassword(IDLE, form({ token: 'old', password: 'a brand new passphrase' }))).resolves.toEqual({
      kind: 'error',
      error: 'reset_link',
    })
  })

  test('reset worked but signing in failed: the password changed, never "use the link again"', async () => {
    um.resetPassword.mockResolvedValue({ user: { id: 'user_01A', email: 'ada@example.com' } })
    um.authenticateWithPassword.mockRejectedValue(workosError({ name: 'GenericServerException', status: 503 }))

    await expect(resetPassword(IDLE, form({ token: 'reset-token', password: 'a brand new passphrase' }))).resolves.toEqual({
      kind: 'notice',
      notice: 'password_updated',
    })
  })
})
