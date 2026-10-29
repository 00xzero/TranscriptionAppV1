/** @jest-environment node */

import '../helpers/authEnv'
import { isValidElement, type ReactElement } from 'react'
import { createCookieJar } from '../helpers/cookieJar'
import AuthPage from '@/app/auth/page'
import { SignInForm, type SignInFormProps } from '@/components/auth/SignInForm'
import { codeAttempts } from '@/lib/auth/attempt-cookies.server'

const mockJar = createCookieJar()
jest.mock('next/headers', () => ({ cookies: async () => mockJar.jar }))
// The page only hands these to the browser; their code isn't under test here.
jest.mock('@/components/auth/SignInForm', () => ({ SignInForm: () => null }))
jest.mock('@/components/auth/AuthFrame', () => ({ AuthFrame: ({ children }: { children: unknown }) => children }))

/** The props the page gives the sign-in form for this URL. */
async function formFor(params: Record<string, string>): Promise<SignInFormProps> {
  const frame = (await AuthPage({ searchParams: Promise.resolve(params) })) as ReactElement<{ children: ReactElement }>
  const form = frame.props.children
  if (!isValidElement(form) || form.type !== SignInForm) throw new Error('the page did not render the sign-in form')
  return form.props as SignInFormProps
}

describe('the sign-in page', () => {
  beforeEach(() => mockJar.clear())

  test('a refresh on the code step reopens it from the attempt’s own cookie, keeping the destination', async () => {
    const attempt = await codeAttempts.save({
      challenge: 'email-verification',
      pendingAuthenticationToken: 'pending-secret',
      email: 'ada@example.com',
      emailVerificationId: 'email_verification_1',
      next: '/editor/abc',
    })

    const props = await formFor({ attempt, next: '/editor/abc' })

    expect(props.pendingCode).toEqual({ attempt, challenge: 'email-verification', email: 'ada@example.com' })
    expect(props.next).toBe('/editor/abc')
    expect(props.initialError).toBeUndefined()
    expect(JSON.stringify(props)).not.toContain('pending-secret')
  })

  test('a Radar challenge reopens as a Radar challenge', async () => {
    const attempt = await codeAttempts.save({
      challenge: 'radar',
      pendingAuthenticationToken: 'pending-radar',
      email: 'ada@example.com',
      radarChallengeId: 'radar_challenge_1',
      next: '/',
    })

    await expect(formFor({ attempt })).resolves.toMatchObject({ pendingCode: { attempt, challenge: 'radar' } })
  })

  test('two tabs’ attempts reopen independently', async () => {
    const first = await codeAttempts.save({ challenge: 'email-verification', pendingAuthenticationToken: 'p1', email: 'one@example.com', next: '/' })
    const second = await codeAttempts.save({ challenge: 'email-verification', pendingAuthenticationToken: 'p2', email: 'two@example.com', next: '/' })

    await expect(formFor({ attempt: first })).resolves.toMatchObject({ pendingCode: { email: 'one@example.com' } })
    await expect(formFor({ attempt: second })).resolves.toMatchObject({ pendingCode: { email: 'two@example.com' } })
  })

  test('an attempt that is gone offers a fresh sign-in and keeps the destination', async () => {
    const props = await formFor({ attempt: 'mabc1234-0123456789abcdef01234567', next: '/projects' })

    expect(props.pendingCode).toBeNull()
    expect(props.initialError).toBe('code_expired')
    expect(props.next).toBe('/projects')
  })

  test('an unknown error code or an off-site destination is ignored', async () => {
    await expect(formFor({ error: 'nonsense', next: 'https://evil.test' })).resolves.toMatchObject({
      initialError: undefined,
      next: '/',
    })
  })
})
