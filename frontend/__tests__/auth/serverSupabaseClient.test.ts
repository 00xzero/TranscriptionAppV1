/** @jest-environment node */

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { refreshSession, withAuth } from '@workos-inc/authkit-nextjs'
import { createClient } from '@/infra/supabase/server'

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({})) }))

const USER = { id: 'user_01A', email: 'a@example.com' }
const LIFETIME = 300
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0)

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** A 5-minute WorkOS access token with this many seconds left. */
function token(sub: string, secondsLeft: number, label = ''): string {
  const exp = nowSeconds() + secondsLeft
  const payload = Buffer.from(JSON.stringify({ sub, iat: exp - LIFETIME, exp, label })).toString('base64url')
  return `header.${payload}.signature`
}

/** The token callback the server client handed supabase-js. */
async function tokenCallback(options?: { refreshSession?: boolean }) {
  await openClient(options)
  return lastTokenCallback()
}

function lastTokenCallback() {
  const [, , clientOptions] = jest.mocked(createSupabaseClient).mock.calls.at(-1)!
  return clientOptions!.accessToken!
}

let open: Partial<AsyncDisposable>[] = []

async function openClient(options?: { refreshSession?: boolean }) {
  const client = (await createClient(options as { refreshSession: true })) as Partial<AsyncDisposable>
  open.push(client)
  return client
}

function signedInWith(accessToken: string) {
  jest.mocked(withAuth).mockResolvedValue({ user: USER, accessToken } as never)
}

/** Moves the clock on, firing any renewal that falls due meanwhile. */
const pass = (seconds: number) => jest.advanceTimersByTimeAsync(seconds * 1000)

/**
 * WorkOS refresh-token rotation: each refresh token works once, and a reuse
 * within 30 seconds of its first use answers with that same new pair.
 */
class FakeWorkos {
  private used = new Map<string, { at: number; next: { refreshToken: string; accessToken: string } }>()
  private issued = 0

  refresh(refreshToken: string) {
    const earlier = this.used.get(refreshToken)
    if (earlier) {
      if (nowSeconds() - earlier.at <= 30) return earlier.next
      throw Object.assign(new Error('invalid_grant'), { isTransient: false })
    }
    this.issued += 1
    const next = { refreshToken: `rt-${this.issued + 1}`, accessToken: token(USER.id, LIFETIME, `pair-${this.issued}`) }
    this.used.set(refreshToken, { at: nowSeconds(), next })
    return next
  }
}

/** The route renews with the refresh token its request cookie carried. */
function routeRenewsWith(workos: FakeWorkos, requestRefreshToken: string) {
  jest.mocked(refreshSession).mockImplementation(async () => {
    const { accessToken } = workos.refresh(requestRefreshToken)
    return { user: USER, accessToken } as never
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers({ now: NOW })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
})

afterEach(async () => {
  await Promise.all(open.map((client) => client[Symbol.asyncDispose]?.()))
  open = []
  jest.useRealTimers()
})

describe('server Supabase client token', () => {
  it('uses the request token while it has time left', async () => {
    const current = token(USER.id, 120)
    signedInWith(current)
    const getToken = await tokenCallback({ refreshSession: true })

    await expect(getToken()).resolves.toBe(current)
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('renews 20 seconds before the browser would, once for parallel requests', async () => {
    signedInWith(token(USER.id, 49))
    const renewed = token(USER.id, LIFETIME)
    jest.mocked(refreshSession).mockResolvedValue({ user: USER, accessToken: renewed } as never)
    const getToken = await tokenCallback({ refreshSession: true })

    await expect(Promise.all([getToken(), getToken(), getToken()])).resolves.toEqual([renewed, renewed, renewed])
    await expect(getToken()).resolves.toBe(renewed)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('renews longer tokens ahead of their 60-second browser lead', async () => {
    const exp = nowSeconds() + 75
    const hourToken = `header.${Buffer.from(JSON.stringify({ sub: USER.id, iat: exp - 3600, exp })).toString('base64url')}.signature`
    signedInWith(hourToken)
    jest.mocked(refreshSession).mockResolvedValue({ user: USER, accessToken: token(USER.id, LIFETIME) } as never)
    const getToken = await tokenCallback({ refreshSession: true })

    await getToken()
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('never renews unless the caller can write the session cookie', async () => {
    const current = token(USER.id, 5)
    signedInWith(current)
    const getToken = await tokenCallback()
    await pass(60)

    await expect(getToken()).resolves.toBe(current)
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it("keeps the request's token when the renewal names someone else", async () => {
    const current = token(USER.id, 5)
    signedInWith(current)
    jest.mocked(refreshSession).mockResolvedValue({
      user: { id: 'user_01B', email: 'b@example.com' },
      accessToken: token('user_01B', LIFETIME),
    } as never)
    const getToken = await tokenCallback({ refreshSession: true })

    await expect(getToken()).resolves.toBe(current)
  })

  it('stops renewing once WorkOS refuses the refresh token for good', async () => {
    const current = token(USER.id, 5)
    signedInWith(current)
    jest.mocked(refreshSession).mockRejectedValue(Object.assign(new Error('invalid_grant'), { isTransient: false }))
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const getToken = await tokenCallback({ refreshSession: true })

    await expect(getToken()).resolves.toBe(current)
    await expect(getToken()).resolves.toBe(current)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('tries again after a renewal that failed for a moment: on the next call, and on its own', async () => {
    signedInWith(token(USER.id, 45))
    const current = token(USER.id, 45)
    const renewed = token(USER.id, LIFETIME)
    const blip = () => Object.assign(new Error('fetch failed'), { isTransient: true })
    jest.mocked(refreshSession)
      .mockRejectedValueOnce(blip())
      .mockRejectedValueOnce(blip())
      .mockResolvedValueOnce({ user: USER, accessToken: renewed } as never)
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const getToken = await tokenCallback({ refreshSession: true })

    await pass(0)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    await expect(getToken()).resolves.toBe(current)
    expect(refreshSession).toHaveBeenCalledTimes(2)

    await pass(5)
    expect(refreshSession).toHaveBeenCalledTimes(3)
    await expect(getToken()).resolves.toBe(renewed)
  })

  it('stops renewing once the route has finished', async () => {
    signedInWith(token(USER.id, 120))
    const client = await openClient({ refreshSession: true })

    await client[Symbol.asyncDispose]!()
    await pass(120)

    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('lets a renewal under way finish before the route does, so its cookie goes out', async () => {
    signedInWith(token(USER.id, 45))
    let finish!: () => void
    jest.mocked(refreshSession).mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ user: USER, accessToken: 'new' } as never)))
    )
    const client = await openClient({ refreshSession: true })
    await pass(0)
    expect(refreshSession).toHaveBeenCalledTimes(1)

    let finished = false
    const closing = client[Symbol.asyncDispose]!().then(() => (finished = true))
    await Promise.resolve()
    expect(finished).toBe(false)
    finish()
    await closing

    await expect(lastTokenCallback()()).resolves.toBe('new')
  })

  it('sends no token when signed out', async () => {
    jest.mocked(withAuth).mockResolvedValue({ user: null } as never)
    const getToken = await tokenCallback({ refreshSession: true })

    await expect(getToken()).resolves.toBeNull()
    expect(refreshSession).not.toHaveBeenCalled()
  })
})

describe('server renewal alongside the browser', () => {
  it('renews on time while a long batch is under way', async () => {
    // A batch starts with 51 s left, not yet due, and takes 55 s with no call
    // asking for a token. The browser renews at 30 s left with the refresh
    // token the request also carries; the route must not wait for its next
    // call, which comes after expiry and 34 s after the browser's renewal.
    const workos = new FakeWorkos()
    signedInWith(token(USER.id, 51))
    routeRenewsWith(workos, 'rt-1')
    const getToken = await tokenCallback({ refreshSession: true })

    await getToken()
    await pass(21)
    const browser = workos.refresh('rt-1')
    await pass(34)

    expect(refreshSession).toHaveBeenCalledTimes(1)
    await expect(getToken()).resolves.toBe(browser.accessToken)
  })

  it('renews before a call that would start with 15 s left, not after it', async () => {
    // Waiting until 10 s before expiry, a 25-second call starting at 15 s
    // left came back 40 s after the browser's renewal, past WorkOS grace.
    const workos = new FakeWorkos()
    signedInWith(token(USER.id, 55))
    routeRenewsWith(workos, 'rt-1')
    const getToken = await tokenCallback({ refreshSession: true })

    await getToken()
    await pass(25)
    const browser = workos.refresh('rt-1')
    await pass(15)
    await expect(getToken()).resolves.toBe(browser.accessToken)
    await pass(25)

    await expect(getToken()).resolves.toBe(browser.accessToken)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('leaves the browser a reuse within WorkOS grace when it renews first', async () => {
    const workos = new FakeWorkos()
    signedInWith(token(USER.id, 45))
    routeRenewsWith(workos, 'rt-1')
    const getToken = await tokenCallback({ refreshSession: true })

    const route = await getToken()
    await pass(15)

    expect(workos.refresh('rt-1').accessToken).toBe(route)
  })
})
