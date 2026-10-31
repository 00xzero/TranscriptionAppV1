/** @jest-environment node */

import '../helpers/authEnv'
import { NextRequest } from 'next/server'
import { saveSession, withAuth } from '@workos-inc/authkit-nextjs'
import { mockWorkOS } from '@/__mocks__/workos-authkit-nextjs'
import { createCookieJar } from '../helpers/cookieJar'
import { makeAuthResponse, workosError } from '../helpers/workosFixtures'
import { GET } from '@/app/auth/callback/route'
import { codeAttempts, newAttemptId, oauthAttempts } from '@/lib/auth/attempt-cookies.server'
import { provisionAppUser } from '@/lib/auth/provision-app-user.server'

const mockJar = createCookieJar()
jest.mock('next/headers', () => ({
  cookies: async () => mockJar.jar,
  headers: async () => new Headers({ 'x-real-ip': '203.0.113.9', 'user-agent': 'TestBrowser/1.0' }),
}))
jest.mock('@/infra/supabase/admin', () => ({ createAdminClient: jest.fn(() => ({})) }))
jest.mock('@/lib/auth/provision-app-user.server', () => ({ provisionAppUser: jest.fn() }))

const exchange = mockWorkOS.userManagement.authenticateWithCode as jest.Mock
const provision = provisionAppUser as jest.Mock
const save = saveSession as jest.Mock
const withAuthMock = withAuth as unknown as jest.Mock

const AUTH = makeAuthResponse()

async function attempt(next = '/editor/abc?t=12') {
  const state = newAttemptId()
  await oauthAttempts.save({ state, provider: 'google', codeVerifier: 'v'.repeat(43), next, signalsId: 'radar-token' })
  return state
}

// A container's request URL may be 0.0.0.0; redirects use the configured origin.
function callback(query: string) {
  return GET(new NextRequest(`http://0.0.0.0:3000/auth/callback?${query}`))
}

const location = (response: Response) => response.headers.get('location')

describe('GET /auth/callback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockJar.clear()
    provision.mockResolvedValue('app-user-a')
    withAuthMock.mockResolvedValue({ user: null })
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  test('exchanges the code with this attempt’s verifier and signals, then goes on through /auth/finish', async () => {
    const state = await attempt()
    exchange.mockResolvedValue(AUTH)

    const response = await callback(`code=c1&state=${state}`)

    expect(location(response)).toBe('http://localhost:3000/auth/finish?to=%2Feditor%2Fabc%3Ft%3D12')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(exchange).toHaveBeenCalledWith({
      clientId: 'client_test',
      code: 'c1',
      codeVerifier: 'v'.repeat(43),
      signalsId: 'radar-token',
      ipAddress: '203.0.113.9',
      userAgent: 'TestBrowser/1.0',
    })
    expect(provision.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0])
    // Only the account cookie, naming who signed in.
    expect(mockJar.names()).toEqual(['olivetti-account'])
    expect(mockJar.store.get('olivetti-account')?.value).toBe('app-user-a')
  })

  test('provisioning that keeps failing writes no session, and the person signs in again with their destination kept', async () => {
    const state = await attempt()
    exchange.mockResolvedValue(AUTH)
    provision.mockRejectedValue(new Error('db down'))

    const response = await callback(`code=c1&state=${state}`)

    expect(location(response)).toBe('http://localhost:3000/auth?error=not_finished&next=%2Feditor%2Fabc%3Ft%3D12')
    expect(save).not.toHaveBeenCalled()
    expect(mockJar.names()).toEqual([])
  })

  test('an unconfirmed account with that email opens the code step', async () => {
    const state = await attempt()
    exchange.mockRejectedValue(
      workosError({
        name: 'AuthenticationException',
        status: 400,
        code: 'email_verification_required',
        pendingAuthenticationToken: 'pending-secret',
        rawData: { email: 'ada@example.com', email_verification_id: 'email_verification_1' },
      })
    )

    const url = new URL(location(await callback(`code=c1&state=${state}`))!)

    expect(url.pathname).toBe('/auth')
    expect(url.searchParams.get('next')).toBe('/editor/abc?t=12')
    expect(url.toString()).not.toContain('pending-secret')
    await expect(codeAttempts.read(url.searchParams.get('attempt')!)).resolves.toMatchObject({
      challenge: 'email-verification',
      pendingAuthenticationToken: 'pending-secret',
      next: '/editor/abc?t=12',
    })
  })

  test('a Radar OAuth challenge keeps the destination email from WorkOS’s nested user', async () => {
    const challenged = await attempt()
    exchange.mockRejectedValueOnce(
      workosError({
        name: 'AuthenticationException',
        status: 400,
        code: 'radar_email_challenge',
        pendingAuthenticationToken: 'pending-radar',
        radarChallengeId: 'radar_challenge_1',
        rawData: { user: { id: 'user_01A', email: 'ada@example.com' } },
      })
    )
    const url = new URL(location(await callback(`code=c1&state=${challenged}`))!)
    await expect(codeAttempts.read(url.searchParams.get('attempt')!)).resolves.toMatchObject({
      challenge: 'radar',
      email: 'ada@example.com',
      radarChallengeId: 'radar_challenge_1',
      pendingAuthenticationToken: 'pending-radar',
      next: '/editor/abc?t=12',
    })
  })

  test('a Radar block says so', async () => {
    const blocked = await attempt()
    exchange.mockRejectedValueOnce(workosError({ name: 'GenericServerException', status: 403, code: 'policy_denied' }))
    expect(location(await callback(`code=c1&state=${blocked}`))).toBe(
      'http://localhost:3000/auth?error=blocked&next=%2Feditor%2Fabc%3Ft%3D12'
    )
  })

  test('cancelled at the provider: back to sign-in with the destination kept, the attempt spent', async () => {
    const state = await attempt()

    const response = await callback(`error=access_denied&state=${state}`)

    expect(location(response)).toBe('http://localhost:3000/auth?error=oauth&next=%2Feditor%2Fabc%3Ft%3D12')
    expect(exchange).not.toHaveBeenCalled()
    expect(mockJar.names()).toEqual([])
  })

  test('a used code is a failed sign-in, never a retry', async () => {
    const state = await attempt()
    exchange.mockRejectedValue(workosError({ name: 'OauthException', status: 400, error: 'invalid_grant' }))

    expect(location(await callback(`code=used&state=${state}`))).toBe(
      'http://localhost:3000/auth?error=oauth&next=%2Feditor%2Fabc%3Ft%3D12'
    )
  })

  test('no cookie, an expired or tampered one, or a state that isn’t ours: back to sign-in', async () => {
    expect(location(await callback('code=c1&state=mabc1234-0123456789abcdef01234567'))).toBe(
      'http://localhost:3000/auth?error=oauth'
    )

    const state = await attempt()
    const name = `olivetti-oauth-${state}`
    mockJar.store.set(name, { value: mockJar.store.get(name)!.value.replace(/.$/, 'x') })
    expect(location(await callback(`code=c1&state=${state}`))).toBe('http://localhost:3000/auth?error=oauth')

    expect(location(await callback('code=c1'))).toBe('http://localhost:3000/auth?error=oauth')
    expect(exchange).not.toHaveBeenCalled()
  })

  test('two attempts in two tabs finish in either order without clearing each other', async () => {
    const first = await attempt('/projects/p1')
    const second = await attempt('/people')
    exchange.mockResolvedValue(AUTH)

    expect(location(await callback(`code=c2&state=${second}`))).toBe('http://localhost:3000/auth/finish?to=%2Fpeople')
    expect(mockJar.names()).toEqual(['olivetti-account', `olivetti-oauth-${first}`])
    expect(location(await callback(`code=c1&state=${first}`))).toBe('http://localhost:3000/auth/finish?to=%2Fprojects%2Fp1')
  })

  test('an old callback link for someone still signed in goes to the Library and keeps their session', async () => {
    withAuthMock.mockResolvedValue({ user: { id: 'user_01A' } })

    const response = await callback('code=old&state=mabc1234-0123456789abcdef01234567')

    expect(location(response)).toBe('http://localhost:3000/')
    expect(save).not.toHaveBeenCalled()
  })
})
