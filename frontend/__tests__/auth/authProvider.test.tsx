import React, { StrictMode } from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { AuthProvider, SIGN_IN_UNCONFIRMED_MESSAGE, useAuth } from '@/lib/auth/AuthProvider'
import { getAccessToken, notifyAccountChanged } from '@/infra/workos/access-token'
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/auth/account-boundary'
import {
  accessTokenFor,
  mockGetAccessToken,
  mockRefreshAuth,
  resetAuthKitState,
  setAuthKitState,
  workosUser,
} from '@/__mocks__/workos-authkit-nextjs-components'

const mockRpc = jest.fn()
const mockSetRealtimeAuth = jest.fn()
const mockRealtimeDisconnect = jest.fn()

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    rpc: mockRpc,
    realtime: { setAuth: mockSetRealtimeAuth, disconnect: mockRealtimeDisconnect },
  }),
}))

type RpcResult = { data: string | null; error: { message: string } | null }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function Probe() {
  const { user, userId, ready, accountChange } = useAuth()
  return (
    <div>
      <span data-testid="user-id">{userId ?? ''}</span>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="change">{accountChange ?? ''}</span>
      <span data-testid="email">{user?.email ?? ''}</span>
      <span data-testid="name">{user?.name ?? ''}</span>
    </div>
  )
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
}

/** Renders the provider for WorkOS user A, once it shows A's own user id. */
async function renderAsA(state: Parameters<typeof setAuthKitState>[0] = {}) {
  setAuthKitState({ user: workosUser('user_A'), ...state })
  mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
  const view = renderProvider()
  await waitFor(() => expectIdentity('app-user-a', true))
  return view
}

/** What the browser's account cookie says (account-marker.ts); null removes it. */
function markAccount(value: string | null) {
  document.cookie = value === null ? 'olivetti-account=; max-age=0; path=/' : `olivetti-account=${value}; path=/`
}

function expectChange(change: string) {
  expect(screen.getByTestId('change').textContent).toBe(change)
}

function expectIdentity(userId: string, ready: boolean) {
  expect(screen.getByTestId('user-id').textContent).toBe(userId)
  expect(screen.getByTestId('ready')).toHaveTextContent(String(ready))
}

const resolvesTo = (userId: string | null): RpcResult => ({ data: userId, error: null })
const lookupFailure: RpcResult = { data: null, error: { message: 'Failed to fetch' } }

/** Lets every pending promise and the effects they cause run (one event-loop turn). */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAuthKitState()
    // Signed in as A, as a sign-in writes it.
    markAccount('app-user-a')
    mockRpc.mockReset()
    mockRpc.mockResolvedValue(resolvesTo(null))
    mockSetRealtimeAuth.mockReset()
    mockSetRealtimeAuth.mockResolvedValue(undefined)
  })

  test('starts unresolved while WorkOS is still loading', () => {
    setAuthKitState({ loading: true })
    renderProvider()

    expectIdentity('', false)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  test('settles as signed out without a lookup when there is no WorkOS user', async () => {
    renderProvider()

    await waitFor(() => expectIdentity('', true))
    expect(mockRpc).not.toHaveBeenCalled()
  })

  test('resolves a WorkOS user to our own user id, with their email and name', async () => {
    setAuthKitState({
      user: workosUser('user_01A', { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }),
    })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))

    renderProvider()

    await waitFor(() => expectIdentity('app-user-a', true))
    expect(mockRpc).toHaveBeenCalledWith('current_user_id')
    expect(screen.getByTestId('email')).toHaveTextContent('ada@example.com')
    expect(screen.getByTestId('name')).toHaveTextContent('Ada Lovelace')
  })

  test('treats a WorkOS user with no account here as signed out', async () => {
    setAuthKitState({ user: workosUser('user_unlinked') })

    renderProvider()

    await waitFor(() => expectIdentity('', true))
  })

  test('a failed lookup stays unresolved rather than signed out, and retries with backoff', async () => {
    jest.useFakeTimers()
    try {
      setAuthKitState({ user: workosUser('user_A') })
      mockRpc
        .mockResolvedValueOnce(lookupFailure)
        .mockResolvedValueOnce(lookupFailure)
        .mockResolvedValue(resolvesTo('app-user-a'))

      renderProvider()
      await act(async () => {})
      expect(mockRpc).toHaveBeenCalledTimes(1)
      expectIdentity('', false)

      await act(async () => jest.advanceTimersByTime(1000))
      expect(mockRpc).toHaveBeenCalledTimes(2)

      // The second retry waits twice as long.
      await act(async () => jest.advanceTimersByTime(1000))
      expect(mockRpc).toHaveBeenCalledTimes(2)
      await act(async () => jest.advanceTimersByTime(1000))
      expect(mockRpc).toHaveBeenCalledTimes(3)
      expectIdentity('app-user-a', true)
    } finally {
      jest.useRealTimers()
    }
  })

  test('retries failed realtime authentication without publishing a ready account', async () => {
    jest.useFakeTimers()
    try {
      setAuthKitState({ user: workosUser('user_A') })
      mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
      mockSetRealtimeAuth.mockRejectedValueOnce(new Error('Authentication failed'))
      renderProvider()
      await act(async () => {})
      expectIdentity('', false)

      await act(async () => jest.advanceTimersByTime(1000))
      expect(mockSetRealtimeAuth).toHaveBeenCalledTimes(2)
      expectIdentity('app-user-a', true)
    } finally {
      jest.useRealTimers()
    }
  })

  test.each([
    { change: 'switching to B', next: { user: workosUser('user_B') }, shows: 'app-user-b' },
    { change: 'signing out', next: { user: null }, shows: '' },
  ])('drops a lookup that finishes after $change', async ({ next, shows }) => {
    markAccount('app-user-b')
    const lookupA = deferred<RpcResult>()
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockReturnValueOnce(lookupA.promise).mockResolvedValue(resolvesTo('app-user-b'))

    renderProvider()
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1))

    act(() => setAuthKitState(next))
    await waitFor(() => expectIdentity(shows, true))

    await act(async () => {
      lookupA.resolve(resolvesTo('app-user-a'))
      await lookupA.promise
    })
    expectIdentity(shows, true)
  })

  test('a page keeps the account it settled on: AuthKit reporting B freezes it instead', async () => {
    await renderAsA()
    markAccount('app-user-b')
    mockRpc.mockResolvedValue(resolvesTo('app-user-b'))

    act(() => setAuthKitState({ user: workosUser('user_B') }))

    await waitFor(() => expectChange('switched'))
    expectIdentity('app-user-a', true)
    // B is never looked up or authenticated in this page.
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockSetRealtimeAuth).toHaveBeenCalledTimes(1)
  })

  test('signOut leaves the page with a form POST to /auth/sign-out, showing the page as it was', async () => {
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    const submitted: Array<{ method: string; action: string }> = []
    const submit = jest
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(function (this: HTMLFormElement) {
        submitted.push({ method: this.method, action: new URL(this.action).pathname })
      })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.userId).toBe('app-user-a'))

    let settled = false
    act(() => {
      void result.current.signOut().then(() => {
        settled = true
      })
    })
    await act(async () => {})

    expect(submitted).toEqual([{ method: 'post', action: '/auth/sign-out' }])
    // No signed-out flash while the browser leaves: the page keeps its user.
    expect(result.current.userId).toBe('app-user-a')
    expect(result.current.ready).toBe(true)
    // The page is leaving: nothing after sign-out should run in it.
    expect(settled).toBe(false)
    submit.mockRestore()
  })

  test('signs Supabase requests with the AuthKit token while mounted', async () => {
    const { unmount } = await renderAsA()
    await expect(getAccessToken()).resolves.toBe(accessTokenFor('user_A'))

    unmount()
    await expect(getAccessToken()).resolves.toBeNull()
  })

  describe('before AuthKit knows the user', () => {
    test('holds a request until AuthKit knows the user, so a page’s first read is never signed out', async () => {
      // A prerendered page: AuthKit learns the user only after load.
      setAuthKitState({ loading: true })
      mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
      renderProvider()

      let answered = false
      const request = getAccessToken().finally(() => {
        answered = true
      })
      await settle()
      expect(answered).toBe(false)
      expect(mockGetAccessToken).not.toHaveBeenCalled()

      act(() => setAuthKitState({ loading: false, user: workosUser('user_A') }))
      await expect(request).resolves.toBe(accessTokenFor('user_A'))
    })

    test('confirms "no user" with a session read before letting a held request go without a token', async () => {
      const read = deferred<undefined>()
      mockRefreshAuth.mockReturnValueOnce(read.promise)
      setAuthKitState({ loading: true })
      renderProvider()

      let answered = false
      const request = getAccessToken().finally(() => {
        answered = true
      })
      act(() => setAuthKitState({ loading: false }))
      await settle()
      // AuthKit's load check said "no user", which a failed check also says.
      expect(mockRefreshAuth).toHaveBeenCalledTimes(1)
      expect(answered).toBe(false)
      expectIdentity('', false)

      await act(async () => {
        read.resolve(undefined)
        await read.promise
      })
      await expect(request).resolves.toBeNull()
      expectIdentity('', true)
    })

    test('a held request does not hang when the provider unmounts', async () => {
      setAuthKitState({ loading: true })
      const { unmount } = renderProvider()
      const request = getAccessToken()

      unmount()
      await expect(request).resolves.toBeNull()
    })

    test('a failed session read fails held and new requests rather than sending them signed out, and recovers', async () => {
      const read = deferred<unknown>()
      mockRefreshAuth
        .mockReturnValueOnce(read.promise as never)
        .mockImplementation(async () => {
          setAuthKitState({ user: workosUser('user_A') })
        })
      mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
      setAuthKitState({ loading: true })
      renderProvider()
      const held = getAccessToken()
      const rejected = expect(held).rejects.toThrow(SIGN_IN_UNCONFIRMED_MESSAGE)

      // AuthKit's load check failed and hid it ("no user").
      act(() => setAuthKitState({ loading: false }))
      expect(mockRefreshAuth).toHaveBeenCalledTimes(1)
      await act(async () => {
        read.resolve({ error: 'Failed to fetch' })
        await read.promise
      })
      await rejected
      await expect(getAccessToken()).rejects.toThrow(SIGN_IN_UNCONFIRMED_MESSAGE)
      expect(mockGetAccessToken).not.toHaveBeenCalled()
      expectIdentity('', false)

      // The connection coming back reads the session again, well before the
      // first timed retry (1 s).
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      await waitFor(() => expectIdentity('app-user-a', true), { timeout: 500 })
      await expect(getAccessToken()).resolves.toBe(accessTokenFor('user_A'))
    })
  })

  describe('when the account changes in another tab', () => {
    test('a request made before any event notices reads the cookie and is never sent', async () => {
      await renderAsA()
      const calls = mockGetAccessToken.mock.calls.length
      // Another tab signed in as B a moment ago; this tab has had no event yet.
      markAccount('app-user-b')

      await act(async () => {
        await expect(getAccessToken('app-user-a')).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)
        await expect(getAccessToken()).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)
      })
      expect(mockGetAccessToken).toHaveBeenCalledTimes(calls)
      expectChange('switched')
      expectIdentity('app-user-a', true)
      expect(mockRealtimeDisconnect).toHaveBeenCalledTimes(1)
    })

    test.each([
      { cookie: 'app-user-b', change: 'switched' },
      { cookie: 'none', change: 'signed-out' },
      { cookie: null, change: 'sign-in-again' },
    ])('the cookie saying $cookie freezes the page on focus as $change', async ({ cookie, change }) => {
      await renderAsA()
      markAccount(cookie)

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      expectChange(change)
      expectIdentity('app-user-a', true)
    })

    test.each(['visibilitychange', 'pageshow'])('%s also checks the cookie', async (event) => {
      await renderAsA()
      markAccount('none')

      act(() => {
        const target = event === 'pageshow' ? window : document
        target.dispatchEvent(new Event(event))
      })

      expectChange('signed-out')
    })

    test('a visible tab notices within two seconds with no event; a hidden one waits until it is seen', async () => {
      jest.useFakeTimers()
      const visibility = jest.spyOn(document, 'visibilityState', 'get')
      try {
        visibility.mockReturnValue('hidden')
        setAuthKitState({ user: workosUser('user_A') })
        mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
        renderProvider()
        await act(async () => {})
        expectIdentity('app-user-a', true)

        markAccount('app-user-b')
        await act(async () => jest.advanceTimersByTime(4000))
        expectChange('')

        visibility.mockReturnValue('visible')
        await act(async () => jest.advanceTimersByTime(2000))
        expectChange('switched')
      } finally {
        visibility.mockRestore()
        jest.useRealTimers()
      }
    })

    test('the same account signing in again elsewhere changes nothing', async () => {
      await renderAsA()
      markAccount('app-user-a')

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      expectChange('')
      await expect(getAccessToken('app-user-a')).resolves.toBe(accessTokenFor('user_A'))
    })

    test('a token issued for someone else freezes the page and is never sent', async () => {
      await renderAsA()
      mockGetAccessToken.mockResolvedValueOnce(accessTokenFor('user_B'))

      await act(async () => {
        await expect(getAccessToken()).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)
      })

      expectChange('switched')
      expectIdentity('app-user-a', true)
    })

    test.each([
      { cause: 'the cookie changes', change: () => markAccount('app-user-b') },
      { cause: 'a route reports the change', change: notifyAccountChanged },
    ])('a token already being fetched when $cause is withheld', async ({ change }) => {
      await renderAsA()
      const pendingToken = deferred<string>()
      mockGetAccessToken.mockReturnValueOnce(pendingToken.promise)
      const request = getAccessToken('app-user-a')
      const refused = expect(request).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)

      await act(async () => change())
      await act(async () => {
        pendingToken.resolve(accessTokenFor('user_A'))
        await refused
      })
      expectChange('switched')
    })

    test('AuthKit reporting no one after the page settled freezes it as signed out', async () => {
      await renderAsA()

      act(() => setAuthKitState({ user: null }))

      await waitFor(() => expectChange('signed-out'))
      expectIdentity('app-user-a', true)
    })

    test('nothing un-freezes a page: not the cookie, AuthKit or a token coming back to A', async () => {
      await renderAsA()
      markAccount('app-user-b')
      act(() => {
        window.dispatchEvent(new Event('focus'))
      })
      expectChange('switched')

      markAccount('app-user-a')
      act(() => {
        setAuthKitState({ user: workosUser('user_A') })
        window.dispatchEvent(new Event('focus'))
      })

      expectChange('switched')
      await expect(getAccessToken('app-user-a')).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)
      await expect(getAccessToken()).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)
    })

    test('freezing pauses playback at once, before the app unmounts under the cover', async () => {
      await renderAsA()
      const audio = document.createElement('audio')
      document.body.appendChild(audio)
      const pause = jest.spyOn(audio, 'pause').mockImplementation(() => {})
      markAccount('none')

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      expect(pause).toHaveBeenCalledTimes(1)
      audio.remove()
    })

    test('a page that never settled on an account ignores the cookie', async () => {
      markAccount(null)
      setAuthKitState({ user: workosUser('user_unlinked') })
      renderProvider()
      await waitFor(() => expectIdentity('', true))

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      expectChange('')
    })
  })

  test('resolves once and keeps identity through Strict Mode effect replay', async () => {
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))

    render(
      <StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </StrictMode>
    )

    await waitFor(() => expectIdentity('app-user-a', true))
  })

  test('useAuth throws outside AuthProvider', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider')
    errorSpy.mockRestore()
  })
})
