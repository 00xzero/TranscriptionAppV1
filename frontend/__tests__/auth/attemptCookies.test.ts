/** @jest-environment node */

import '../helpers/authEnv'
import { sealData } from 'iron-session'
import { createCookieJar } from '../helpers/cookieJar'
import { codeAttempts, newAttemptId, oauthAttempts } from '@/lib/auth/attempt-cookies.server'

const mockJar = createCookieJar()
jest.mock('next/headers', () => ({ cookies: async () => mockJar.jar }))

const PASSWORD = process.env.WORKOS_COOKIE_PASSWORD!

const emailAttempt = (email = 'ada@example.com') => ({
  challenge: 'email-verification' as const,
  pendingAuthenticationToken: 'pending-1',
  email,
  emailVerificationId: 'email_verification_1',
  next: '/editor/abc',
})

describe('sign-in attempt cookies', () => {
  let now = Date.UTC(2026, 9, 28, 12)

  beforeEach(() => {
    mockJar.clear()
    jest.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => jest.restoreAllMocks())

  test('a Google/Microsoft attempt is sealed under its own state, HttpOnly, Lax, scoped to /auth, for 10 minutes', async () => {
    const state = newAttemptId()
    await oauthAttempts.save({ state, provider: 'google', codeVerifier: 'v'.repeat(43), next: '/', signalsId: 'sig' })

    const stored = mockJar.store.get(`olivetti-oauth-${state}`)!
    expect(stored.value).not.toContain('v'.repeat(43))
    expect(stored.options).toEqual({ httpOnly: true, sameSite: 'lax', secure: false, path: '/auth', maxAge: 600 })
    await expect(oauthAttempts.read(state)).resolves.toMatchObject({ provider: 'google', signalsId: 'sig' })
  })

  test('a code attempt keeps the pending token server-side; the page only gets its id', async () => {
    const id = await codeAttempts.save(emailAttempt())

    expect(id).toMatch(/^[a-z0-9]+-[a-f0-9]{24}$/)
    expect(mockJar.store.get(`olivetti-code-${id}`)!.value).not.toContain('pending-1')
    await expect(codeAttempts.read(id)).resolves.toEqual(emailAttempt())
  })

  test('refuses a tampered, wrong-shaped, expired or unknown cookie', async () => {
    const id = await codeAttempts.save(emailAttempt())
    const name = `olivetti-code-${id}`

    mockJar.store.set(name, { value: mockJar.store.get(name)!.value.replace(/.$/, 'x') })
    await expect(codeAttempts.read(id)).resolves.toBeNull()

    mockJar.store.set(name, { value: await sealData({ hello: 'world' }, { password: PASSWORD, ttl: 600 }) })
    await expect(codeAttempts.read(id)).resolves.toBeNull()

    mockJar.store.set(name, { value: await sealData(emailAttempt(), { password: PASSWORD, ttl: 600 }) })
    now += 11 * 60 * 1000
    await expect(codeAttempts.read(id)).resolves.toBeNull()

    await expect(codeAttempts.read('not-an-id')).resolves.toBeNull()
    await expect(oauthAttempts.read(newAttemptId())).resolves.toBeNull()
  })

  test('two attempts stay independent, and clearing one leaves the other', async () => {
    const first = await codeAttempts.save(emailAttempt('first@example.com'))
    now += 1
    const second = await codeAttempts.save(emailAttempt('second@example.com'))

    await codeAttempts.clear(first)

    await expect(codeAttempts.read(first)).resolves.toBeNull()
    await expect(codeAttempts.read(second)).resolves.toMatchObject({ email: 'second@example.com' })
  })

  test('keeps at most five of each kind: a sixth replaces the oldest', async () => {
    const ids: string[] = []
    for (let i = 0; i < 6; i++) {
      now += 1000
      ids.push(await codeAttempts.save(emailAttempt(`person${i}@example.com`)))
    }
    const state = newAttemptId()
    await oauthAttempts.save({ state, provider: 'microsoft', codeVerifier: 'v'.repeat(43), next: '/' })

    const codes = mockJar.names().filter((name) => name.startsWith('olivetti-code-'))
    expect(codes).toHaveLength(5)
    await expect(codeAttempts.read(ids[0])).resolves.toBeNull()
    await expect(codeAttempts.read(ids[5])).resolves.toMatchObject({ email: 'person5@example.com' })
    // The other kind is counted on its own.
    await expect(oauthAttempts.read(state)).resolves.toMatchObject({ provider: 'microsoft' })
  })
})
