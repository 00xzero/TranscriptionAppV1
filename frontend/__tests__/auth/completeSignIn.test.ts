/** @jest-environment node */

import '../helpers/authEnv'
import { sealData } from 'iron-session'
import { saveSession } from '@workos-inc/authkit-nextjs'
import type { AuthenticationResponse } from '@workos-inc/node'
import { completeSignIn, sessionOf } from '@/lib/auth/complete-sign-in.server'
import { provisionAppUser } from '@/lib/auth/provision-app-user.server'
import { createCookieJar } from '../helpers/cookieJar'

const mockJar = createCookieJar()
jest.mock('next/headers', () => ({ cookies: async () => mockJar.jar }))
jest.mock('@/infra/supabase/admin', () => ({ createAdminClient: jest.fn(() => ({})) }))
jest.mock('@/lib/auth/provision-app-user.server', () => ({ provisionAppUser: jest.fn() }))

const save = saveSession as jest.Mock

// A realistic WorkOS answer: JWT-sized tokens and a full user.
const USER = {
  object: 'user',
  id: 'user_01M5MPPTWA83CYYBRZ4XC9QFW0',
  email: 'ada@example.com',
  emailVerified: true,
  firstName: 'Ada',
  lastName: 'Lovelace',
  profilePictureUrl: 'https://example.com/a.png',
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
  lastSignInAt: '2026-10-28T12:00:00.000Z',
  externalId: null,
  metadata: {},
} as unknown as AuthenticationResponse['user']
const NORMAL: AuthenticationResponse = {
  user: USER,
  accessToken: 'a'.repeat(900),
  refreshToken: 'r'.repeat(25),
  authenticationMethod: 'GoogleOAuth',
  organizationId: 'org_01',
}
// What a Google/Microsoft sign-in can add: the provider's own tokens.
const WITH_PROVIDER_TOKENS: AuthenticationResponse = {
  ...NORMAL,
  oauthTokens: {
    accessToken: 'p'.repeat(1800),
    refreshToken: 'q'.repeat(900),
    expiresAt: 1793228000,
    scopes: ['openid', 'email', 'profile'],
  },
}

// AuthKit's encryptSession: iron-session with the cookie password.
const sealed = (value: unknown) => sealData(value, { password: process.env.WORKOS_COOKIE_PASSWORD!, ttl: 0 })

describe('completeSignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockJar.clear()
    ;(provisionAppUser as jest.Mock).mockResolvedValue('app-user-a')
  })

  test('says which account the session is now, in a cookie every tab can read', async () => {
    await completeSignIn(NORMAL, '/')

    expect(mockJar.store.get('olivetti-account')).toEqual({
      value: 'app-user-a',
      options: expect.objectContaining({ httpOnly: false, sameSite: 'lax', path: '/', secure: false }),
    })
  })

  test('a session that could not be saved names no account', async () => {
    save.mockRejectedValueOnce(new Error('cookie too large'))

    await expect(completeSignIn(NORMAL, '/')).resolves.toBeNull()
    expect(mockJar.names()).toEqual([])
  })

  test('saves only the session AuthKit keeps: no provider tokens, no extra fields', async () => {
    await expect(completeSignIn(WITH_PROVIDER_TOKENS, '/projects')).resolves.toBe(
      'http://localhost:3000/auth/finish?to=%2Fprojects'
    )

    const saved = save.mock.calls[0][0]
    expect(Object.keys(saved).sort()).toEqual(['accessToken', 'authenticationMethod', 'impersonator', 'refreshToken', 'user'])
    expect(saved).not.toHaveProperty('oauthTokens')
    expect(saved).toMatchObject({ accessToken: NORMAL.accessToken, refreshToken: NORMAL.refreshToken, user: USER })
  })

  test('large provider tokens leave the cookie the same size as a normal session, well under 4 KB', async () => {
    const normal = (await sealed(sessionOf(NORMAL))).length
    const withProvider = (await sealed(sessionOf(WITH_PROVIDER_TOKENS))).length
    const wholeAnswer = (await sealed(WITH_PROVIDER_TOKENS)).length

    expect(withProvider).toBe(normal)
    expect(withProvider).toBeLessThan(4096 - 100)
    // What sealing the whole answer would have done.
    expect(wholeAnswer).toBeGreaterThan(4096)
  })

  test('keeps who impersonated, when WorkOS says so', () => {
    const impersonator = { email: 'support@example.com', reason: 'help' }
    expect(sessionOf({ ...NORMAL, impersonator }).impersonator).toEqual(impersonator)
  })

  test('an answer without session tokens writes no session', async () => {
    await expect(completeSignIn({ ...NORMAL, refreshToken: '' }, '/')).resolves.toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect(provisionAppUser).not.toHaveBeenCalled()
    expect(mockJar.names()).toEqual([])
  })
})
