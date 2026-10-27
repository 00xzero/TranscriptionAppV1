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

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({ rpc: mockRpc, realtime: { setAuth: mockSetRealtimeAuth } }),
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
  const { user, userId, ready } = useAuth()
  return (
    <div>
      <span data-testid="user-id">{userId ?? ''}</span>
      <span data-testid="ready">{String(ready)}</span>
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

const resolvesTo = (userId: string | null): RpcResult => ({ data: userId, error: null })

/** Lets every pending promise and the effects they cause run (one event-loop turn). */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAuthKitState()
    mockRpc.mockResolvedValue(resolvesTo(null))
    mockSetRealtimeAuth.mockResolvedValue(undefined)
  })

  test('starts unresolved while WorkOS is still loading', () => {
    setAuthKitState({ loading: true })
    renderProvider()

    expect(screen.getByTestId('ready')).toHaveTextContent('false')
    expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  test('settles as signed out without a lookup when there is no WorkOS user', async () => {
    renderProvider()

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  test('resolves a WorkOS user to our own user id, with their email and name', async () => {
    setAuthKitState({
      user: workosUser('user_01A', { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }),
    })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    expect(mockRpc).toHaveBeenCalledWith('current_user_id')
    expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a')
    expect(screen.getByTestId('email')).toHaveTextContent('ada@example.com')
    expect(screen.getByTestId('name')).toHaveTextContent('Ada Lovelace')
  })

  test('treats a WorkOS user with no account here as signed out', async () => {
    setAuthKitState({ user: workosUser('user_unlinked') })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()
  })

  test('does not expose the replacement account until realtime authentication finishes', async () => {
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))

    const authentication = deferred<void>()
    mockSetRealtimeAuth.mockReturnValueOnce(authentication.promise)
    mockRpc.mockResolvedValue(resolvesTo('app-user-b'))
    act(() => setAuthKitState({ user: workosUser('user_B') }))
    await waitFor(() => expect(mockSetRealtimeAuth).toHaveBeenLastCalledWith(accessTokenFor('user_B')))
    expect(screen.getByTestId('ready')).toHaveTextContent('false')
    expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()

    await act(async () => authentication.resolve())
    expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-b')
  })

  test('retries failed realtime authentication without publishing a ready account', async () => {
    jest.useFakeTimers()
    try {
      setAuthKitState({ user: workosUser('user_A') })
      mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
      mockSetRealtimeAuth.mockRejectedValueOnce(new Error('Authentication failed'))
      renderProvider()
      await act(async () => {})
      expect(screen.getByTestId('ready')).toHaveTextContent('false')
      expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()

      await act(async () => jest.advanceTimersByTime(1000))
      expect(mockSetRealtimeAuth).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a')
    } finally {
      jest.useRealTimers()
    }
  })

  test('stays unresolved when the lookup fails, rather than claiming signed out', async () => {
    setAuthKitState({ user: workosUser('user_01A') })
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network' } })

    renderProvider()

    await waitFor(() => expect(mockRpc).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.getByTestId('ready')).toHaveTextContent('false')
    expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()
  })

  test('drops a lookup that finishes after switching accounts', async () => {
    const lookupA = deferred<RpcResult>()
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockReturnValueOnce(lookupA.promise).mockResolvedValueOnce(resolvesTo('app-user-b'))

    renderProvider()
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1))

    act(() => setAuthKitState({ user: workosUser('user_B') }))
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-b'))

    await act(async () => {
      lookupA.resolve(resolvesTo('app-user-a'))
      await lookupA.promise
    })
    expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-b')
  })

  test('drops a lookup that finishes after signing out', async () => {
    const lookup = deferred<RpcResult>()
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockReturnValueOnce(lookup.promise)

    renderProvider()
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1))

    act(() => setAuthKitState({ user: null }))
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))

    await act(async () => {
      lookup.resolve(resolvesTo('app-user-a'))
      await lookup.promise
    })
    expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()
  })

  test('drops a lookup that finishes after unmount', async () => {
    const lookup = deferred<RpcResult>()
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockReturnValueOnce(lookup.promise)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const { unmount } = renderProvider()
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      lookup.resolve(resolvesTo('app-user-a'))
      await lookup.promise
    })
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
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
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    mockGetAccessToken.mockResolvedValue(accessTokenFor('user_A'))

    const { unmount } = renderProvider()
    await expect(getAccessToken()).resolves.toBe(accessTokenFor('user_A'))

    unmount()
    await expect(getAccessToken()).resolves.toBeNull()
  })

  test('holds a request until AuthKit knows the user, so a page’s first read is never signed out', async () => {
    // A prerendered page: AuthKit learns the user only after load.
    setAuthKitState({ loading: true })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    mockGetAccessToken.mockResolvedValue(accessTokenFor('user_A'))
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
    expect(screen.getByTestId('ready')).toHaveTextContent('false')

    await act(async () => {
      read.resolve(undefined)
      await read.promise
    })
    await expect(request).resolves.toBeNull()
    expect(screen.getByTestId('ready')).toHaveTextContent('true')
  })

  test('a held request does not hang when the provider unmounts', async () => {
    setAuthKitState({ loading: true })
    const { unmount } = renderProvider()
    const request = getAccessToken()

    unmount()
    await expect(request).resolves.toBeNull()
  })

  test('a failed check on load, with no eager token, fails reads rather than sending them signed out, and recovers', async () => {
    jest.useFakeTimers()
    try {
      // AuthKit's load check failed and hid it ("no user"); no eager token came with the page.
      setAuthKitState({ loading: false })
      mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
      mockGetAccessToken.mockResolvedValue(accessTokenFor('user_A'))
      mockRefreshAuth
        .mockResolvedValueOnce({ error: 'Failed to fetch' } as never)
        .mockImplementation(async () => {
          setAuthKitState({ user: workosUser('user_A') })
        })
      renderProvider()
      await act(async () => {})

      expect(mockRefreshAuth).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('ready')).toHaveTextContent('false')
      await expect(getAccessToken()).rejects.toThrow(SIGN_IN_UNCONFIRMED_MESSAGE)
      expect(mockGetAccessToken).not.toHaveBeenCalled()

      await act(async () => {
        jest.advanceTimersByTime(1000)
      })
      expect(mockRefreshAuth).toHaveBeenCalledTimes(2)
      await act(async () => {})
      expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a')
      await expect(getAccessToken()).resolves.toBe(accessTokenFor('user_A'))
    } finally {
      jest.useRealTimers()
    }
  })

  test('retries a failing session read when the connection comes back', async () => {
    setAuthKitState({ loading: false })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    mockRefreshAuth
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockImplementation(async () => {
        setAuthKitState({ user: workosUser('user_A') })
      })
    renderProvider()
    await settle()
    expect(screen.getByTestId('ready')).toHaveTextContent('false')

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))
  })

  test('an upload bound to A cannot receive B’s token after the displayed account switches', async () => {
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    mockGetAccessToken.mockResolvedValue(accessTokenFor('user_A'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))
    await act(async () => {
      await expect(getAccessToken('app-user-a')).resolves.toBe(accessTokenFor('user_A'))
    })

    mockRpc.mockResolvedValue(resolvesTo('app-user-b'))
    mockGetAccessToken.mockResolvedValue(accessTokenFor('user_B'))
    act(() => setAuthKitState({ user: workosUser('user_B') }))
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-b'))
    await expect(getAccessToken('app-user-a')).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)
  })

  test('rejects a token fetched while the displayed account changes, even if it still belongs to A', async () => {
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))
    const pendingToken = deferred<string>()
    mockGetAccessToken.mockReturnValueOnce(pendingToken.promise)
    const request = getAccessToken('app-user-a')
    const rejected = expect(request).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)
    mockRpc.mockResolvedValue(resolvesTo('app-user-b'))
    act(() => setAuthKitState({ user: workosUser('user_B') }))
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-b'))
    pendingToken.resolve(accessTokenFor('user_A'))
    await rejected
  })

  test('never sends another session’s token, and follows the session to its new account', async () => {
    // Tab A shows user A; another tab has since signed in as B, so the shared
    // session cookie now refreshes into B's token while AuthKit still says A.
    setAuthKitState({ user: workosUser('user_A', { email: 'a@example.com' }) })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))

    mockGetAccessToken.mockResolvedValue(accessTokenFor('user_B'))
    mockRefreshAuth.mockImplementation(async () => {
      setAuthKitState({ user: workosUser('user_B', { email: 'b@example.com' }) })
    })
    mockRpc.mockResolvedValue(resolvesTo('app-user-b'))

    // The next Supabase request: B's token is withheld, not sent as A.
    let tokenSent: string | null = 'unset'
    await act(async () => {
      tokenSent = await getAccessToken()
    })
    expect(tokenSent).toBeNull()
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1)

    // AuthKit now reports the session's user, which resolves like an account
    // switch: A's id and email are never shown alongside B's token.
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-b'))
    expect(screen.getByTestId('email')).toHaveTextContent('b@example.com')
    await expect(getAccessToken()).resolves.toBe(accessTokenFor('user_B'))
  })

  test('goes unresolved while the session belongs to someone the page does not show yet', async () => {
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))

    // AuthKit has not answered yet, so the page still shows A.
    mockGetAccessToken.mockResolvedValue(accessTokenFor('user_B'))
    mockRefreshAuth.mockReturnValue(new Promise(() => undefined))
    await act(async () => {
      await getAccessToken()
      await getAccessToken()
    })

    expect(screen.getByTestId('ready')).toHaveTextContent('false')
    expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()
    expect(screen.getByTestId('email')).toBeEmptyDOMElement()
    // One question to AuthKit, however many requests noticed.
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1)
  })

  test.each(['returned error', 'rejection'])('keeps reconciling a server account mismatch after a %s despite A’s cached token', async (failure) => {
    jest.useFakeTimers()
    try {
      setAuthKitState({ user: workosUser('user_A') })
      mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
      mockGetAccessToken.mockResolvedValue(accessTokenFor('user_A'))
      renderProvider()
      await act(async () => {})
      expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a')

      if (failure === 'rejection') {
        mockRefreshAuth.mockRejectedValueOnce(new Error('Failed to fetch'))
      } else {
        mockRefreshAuth.mockResolvedValueOnce({ error: 'Failed to fetch' } as never)
      }
      mockRefreshAuth
        .mockResolvedValueOnce({ error: 'Still offline' } as never)
        .mockImplementation(async () => {
          mockRpc.mockResolvedValue(resolvesTo('app-user-b'))
          mockGetAccessToken.mockResolvedValue(accessTokenFor('user_B'))
          setAuthKitState({ user: workosUser('user_B') })
        })

      // The create route has confirmed that the shared cookie is B, while
      // AuthKit still holds A's unexpired token in this tab.
      await act(async () => { notifyAccountChanged() })
      expect(mockRefreshAuth).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('ready')).toHaveTextContent('false')

      // A background request must not treat that cached A token as proof
      // that the server's account is A again, or bypass the retry backoff.
      await act(async () => {
        await expect(getAccessToken()).resolves.toBeNull()
      })
      expect(mockRefreshAuth).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()

      await act(async () => { await jest.advanceTimersByTimeAsync(1000) })
      expect(mockRefreshAuth).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('ready')).toHaveTextContent('false')
      await expect(getAccessToken('app-user-a')).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)

      await act(async () => { await jest.advanceTimersByTimeAsync(2000) })
      expect(mockRefreshAuth).toHaveBeenCalledTimes(3)
      expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-b')
      expect(screen.getByTestId('ready')).toHaveTextContent('true')
      await expect(getAccessToken('app-user-a')).rejects.toThrow(ACCOUNT_CHANGED_MESSAGE)
      await expect(getAccessToken('app-user-b')).resolves.toBe(accessTokenFor('user_B'))
    } finally {
      jest.useRealTimers()
    }
  })

  test('asks AuthKit again when its first answer fails, and recovers without a reload', async () => {
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))

    // Another tab signed in as B. AuthKit's first refresh fails (it answers
    // `{ error }` rather than throwing), so the page still shows A.
    mockGetAccessToken.mockResolvedValue(accessTokenFor('user_B'))
    mockRpc.mockResolvedValue(resolvesTo('app-user-b'))
    mockRefreshAuth
      .mockResolvedValueOnce({ error: 'Failed to fetch' } as never)
      .mockImplementation(async () => {
        setAuthKitState({ user: workosUser('user_B') })
      })
    await act(async () => {
      await getAccessToken()
    })
    await settle()
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('ready')).toHaveTextContent('false')

    // Nothing else on the page makes a request; the connection coming back
    // checks the session again.
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-b'))
    expect(mockRefreshAuth).toHaveBeenCalledTimes(2)
  })

  test('keeps checking on its own when a scheduled server check rejects', async () => {
    jest.useFakeTimers()
    try {
      setAuthKitState({ user: workosUser('user_A') })
      mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
      renderProvider()
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a')

      // Another tab signed in as B; AuthKit's first refresh fails.
      mockRpc.mockResolvedValue(resolvesTo('app-user-b'))
      mockGetAccessToken.mockResolvedValue(accessTokenFor('user_B'))
      mockRefreshAuth
        .mockResolvedValueOnce({ error: 'Failed to fetch' } as never)
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockImplementation(async () => {
          setAuthKitState({ user: workosUser('user_B') })
        })
      await act(async () => {
        await getAccessToken()
        await jest.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByTestId('ready')).toHaveTextContent('false')
      expect(mockRefreshAuth).toHaveBeenCalledTimes(1)

      // First scheduled check (1 s): the server check itself rejects.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })
      expect(mockRefreshAuth).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('ready')).toHaveTextContent('false')

      // That failure re-armed the next check (2 s later), with no browser event.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000)
      })
      expect(mockRefreshAuth).toHaveBeenCalledTimes(3)
      expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-b')
      expect(screen.getByTestId('ready')).toHaveTextContent('true')
    } finally {
      jest.useRealTimers()
    }
  })

  test('recovers when the session comes back to the user the page shows', async () => {
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc.mockResolvedValue(resolvesTo('app-user-a'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))

    mockGetAccessToken.mockResolvedValue(accessTokenFor('user_B'))
    mockRefreshAuth.mockResolvedValue({ error: 'Failed to fetch' } as never)
    await act(async () => {
      await getAccessToken()
    })
    await settle()
    expect(screen.getByTestId('ready')).toHaveTextContent('false')

    // A cached token alone cannot establish that the cookie is A again.
    mockGetAccessToken.mockResolvedValue(accessTokenFor('user_A'))
    await act(async () => { await expect(getAccessToken()).resolves.toBeNull() })
    expect(screen.getByTestId('ready')).toHaveTextContent('false')

    // The next server check confirms that the other tab signed back in as A.
    mockRefreshAuth.mockResolvedValue(undefined)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))
    expect(screen.getByTestId('ready')).toHaveTextContent('true')
    await expect(getAccessToken('app-user-a')).resolves.toBe(accessTokenFor('user_A'))
  })

  test('recovers from a failed lookup when the connection comes back, without a reload', async () => {
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
      .mockResolvedValue(resolvesTo('app-user-a'))

    renderProvider()
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1))
    // Let the failure be recorded, which arms the retry.
    await settle()
    expect(screen.getByTestId('ready')).toHaveTextContent('false')

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))
    expect(screen.getByTestId('ready')).toHaveTextContent('true')
    expect(mockRpc).toHaveBeenCalledTimes(2)
  })

  test('retries a failed lookup on its own, with backoff', async () => {
    jest.useFakeTimers()
    try {
      setAuthKitState({ user: workosUser('user_A') })
      mockRpc
        .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
        .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
        .mockResolvedValue(resolvesTo('app-user-a'))

      renderProvider()
      await act(async () => {})
      expect(mockRpc).toHaveBeenCalledTimes(1)

      await act(async () => {
        jest.advanceTimersByTime(1000)
      })
      expect(mockRpc).toHaveBeenCalledTimes(2)

      // The second retry waits twice as long.
      await act(async () => {
        jest.advanceTimersByTime(1000)
      })
      expect(mockRpc).toHaveBeenCalledTimes(2)
      await act(async () => {
        jest.advanceTimersByTime(1000)
      })
      expect(mockRpc).toHaveBeenCalledTimes(3)
      expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a')
    } finally {
      jest.useRealTimers()
    }
  })

  test('a retry never resolves for a user who has since signed out', async () => {
    const retryLookup = deferred<RpcResult>()
    setAuthKitState({ user: workosUser('user_A') })
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
      .mockReturnValueOnce(retryLookup.promise)

    renderProvider()
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1))
    await settle()
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2))

    act(() => setAuthKitState({ user: null }))
    await act(async () => {
      retryLookup.resolve(resolvesTo('app-user-a'))
      await retryLookup.promise
    })

    expect(screen.getByTestId('ready')).toHaveTextContent('true')
    expect(screen.getByTestId('user-id')).toBeEmptyDOMElement()
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

    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('app-user-a'))
    expect(screen.getByTestId('ready')).toHaveTextContent('true')
  })

  test('useAuth throws outside AuthProvider', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider')
    errorSpy.mockRestore()
  })
})
