import React from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider'

type TestUser = { id: string; email?: string; user_metadata?: Record<string, unknown> }
type TestSession = { user: TestUser } | null
type GetUserResult = { data: { user: TestUser | null }; error: Error | null }

const mockGetSession = jest.fn()
const mockGetUser = jest.fn()
const mockOnAuthStateChange = jest.fn()
const mockSignOut = jest.fn()
const mockUnsubscribes: jest.Mock[] = []
let authStateHandler: ((event: string, session: TestSession) => void) | null = null

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
      onAuthStateChange: mockOnAuthStateChange,
      signOut: mockSignOut,
    },
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
)

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper })
}

function identityOf(value: ReturnType<typeof useAuth>) {
  return { user: value.user, userId: value.userId, ready: value.ready }
}

function activeSubscriptions() {
  return mockUnsubscribes.filter((unsubscribe) => unsubscribe.mock.calls.length === 0).length
}

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authStateHandler = null
    mockUnsubscribes.length = 0
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-from-session' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))
    mockSignOut.mockResolvedValue({ error: null })
    mockOnAuthStateChange.mockImplementation((handler) => {
      authStateHandler = handler
      const unsubscribe = jest.fn()
      mockUnsubscribes.push(unsubscribe)
      return { data: { subscription: { unsubscribe } } }
    })
  })

  test('starts unresolved', () => {
    const { result } = renderAuth()
    expect(identityOf(result.current)).toEqual({ user: null, userId: null, ready: false })
  })

  test('exposes the cached user id without marking identity ready before verification', async () => {
    const verified = deferred<GetUserResult>()
    mockGetUser.mockReturnValueOnce(verified.promise)

    const { result } = renderAuth()

    await waitFor(() => expect(result.current.userId).toBe('user-from-session'))
    expect(result.current.ready).toBe(false)
    expect(result.current.user).toBeNull()

    const verifiedUser = { id: 'verified-user', email: 'a@example.com' }
    await act(async () => {
      verified.resolve({ data: { user: verifiedUser }, error: null })
      await verified.promise
    })

    expect(identityOf(result.current)).toEqual({
      user: verifiedUser,
      userId: 'verified-user',
      ready: true,
    })
  })

  test('keeps the cached user id but does not mark identity ready when verification fails', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('invalid session') })

    const { result } = renderAuth()

    await waitFor(() => expect(mockGetUser).toHaveBeenCalled())
    await waitFor(() => {
      expect(identityOf(result.current)).toEqual({
        user: null,
        userId: 'user-from-session',
        ready: false,
      })
    })
  })

  test('settles as signed out without verifying a session that does not exist', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })

    const { result } = renderAuth()

    await waitFor(() => {
      expect(identityOf(result.current)).toEqual({ user: null, userId: null, ready: true })
    })
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  test.each([
    ['sign-out', 'SIGNED_OUT', null, null],
    ['account switch', 'SIGNED_IN', { user: { id: 'user-b' } }, 'user-b'],
    ['password recovery', 'PASSWORD_RECOVERY', { user: { id: 'user-r' } }, 'user-r'],
  ] as const)(
    'ignores stale verification after an auth %s',
    async (_label, event, session, expectedUserId) => {
      const verified = deferred<GetUserResult>()
      mockGetUser.mockReturnValueOnce(verified.promise)

      const { result } = renderAuth()

      await waitFor(() => expect(result.current.userId).toBe('user-from-session'))
      act(() => {
        authStateHandler?.(event, session)
      })
      const expected = {
        user: session?.user ?? null,
        userId: expectedUserId,
        ready: true,
      }
      expect(identityOf(result.current)).toEqual(expected)

      await act(async () => {
        verified.resolve({ data: { user: { id: 'user-from-session' } }, error: null })
        await verified.promise
      })

      expect(identityOf(result.current)).toEqual(expected)
    }
  )

  test('SIGNED_IN after mount populates the full user without a remount', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.ready).toBe(true))

    const signedIn = { id: 'user-a', email: 'a@example.com' }
    act(() => {
      authStateHandler?.('SIGNED_IN', { user: signedIn })
    })

    expect(identityOf(result.current)).toEqual({ user: signedIn, userId: 'user-a', ready: true })
  })

  test('USER_UPDATED replaces user metadata', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'user-a' } }, error: null })
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.ready).toBe(true))

    const updated = { id: 'user-a', user_metadata: { full_name: 'Ada Lovelace' } }
    act(() => {
      authStateHandler?.('USER_UPDATED', { user: updated })
    })

    expect(result.current.user).toBe(updated)
    expect(result.current.userId).toBe('user-a')
  })

  test('INITIAL_SESSION after verification does not downgrade identity', async () => {
    const verifiedUser = { id: 'user-a' }
    mockGetUser.mockResolvedValueOnce({ data: { user: verifiedUser }, error: null })
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => {
      authStateHandler?.('INITIAL_SESSION', { user: { id: 'user-a' } })
    })

    expect(identityOf(result.current)).toEqual({ user: verifiedUser, userId: 'user-a', ready: true })
  })

  test('signOut clears identity immediately, before SIGNED_OUT fires', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'user-a' } }, error: null })
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.userId).toBe('user-a'))

    await act(async () => {
      await result.current.signOut()
    })

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(identityOf(result.current)).toEqual({ user: null, userId: null, ready: true })
  })

  test('signOut clears identity and rethrows when Supabase reports an error', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'user-a' } }, error: null })
    const failure = new Error('network down')
    mockSignOut.mockResolvedValueOnce({ error: failure })
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.userId).toBe('user-a'))

    let thrown: unknown
    await act(async () => {
      thrown = await result.current.signOut().catch((error: unknown) => error)
    })

    expect(thrown).toBe(failure)
    expect(identityOf(result.current)).toEqual({ user: null, userId: null, ready: true })
  })

  test('signOut invalidates an in-flight verification', async () => {
    const verified = deferred<GetUserResult>()
    mockGetUser.mockReturnValueOnce(verified.promise)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.userId).toBe('user-from-session'))

    await act(async () => {
      await result.current.signOut()
    })
    await act(async () => {
      verified.resolve({ data: { user: { id: 'user-from-session' } }, error: null })
      await verified.promise
    })

    expect(identityOf(result.current)).toEqual({ user: null, userId: null, ready: true })
  })

  test('shares one active subscription across consumers and unsubscribes on unmount', async () => {
    function Consumer({ label }: { label: string }) {
      const { userId } = useAuth()
      return <span>{`${label}:${userId ?? 'none'}`}</span>
    }

    const { unmount } = render(
      <AuthProvider>
        <Consumer label="a" />
        <Consumer label="b" />
        <Consumer label="c" />
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByText('a:user-from-session')).toBeInTheDocument())
    expect(screen.getByText('c:user-from-session')).toBeInTheDocument()
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1)
    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(activeSubscriptions()).toBe(1)

    unmount()
    expect(activeSubscriptions()).toBe(0)
  })

  test('keeps exactly one active subscription through Strict Mode effect replay', async () => {
    const strictWrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>
        <AuthProvider>{children}</AuthProvider>
      </React.StrictMode>
    )
    const { result, unmount } = renderHook(() => useAuth(), { wrapper: strictWrapper })

    await waitFor(() => expect(result.current.userId).toBe('user-from-session'))
    // Whether or not effects replay here, every superseded subscription is released.
    expect(activeSubscriptions()).toBe(1)
    mockUnsubscribes.slice(0, -1).forEach((unsubscribe) => {
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    act(() => {
      authStateHandler?.('SIGNED_IN', { user: { id: 'user-b' } })
    })
    expect(result.current.userId).toBe('user-b')

    unmount()
    expect(activeSubscriptions()).toBe(0)
  })

  test('releases the first subscription across a mount, unmount, remount cycle', async () => {
    const first = renderAuth()
    await waitFor(() => expect(first.result.current.userId).toBe('user-from-session'))
    first.unmount()

    const second = renderAuth()
    await waitFor(() => expect(second.result.current.userId).toBe('user-from-session'))

    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(2)
    expect(mockUnsubscribes[0]).toHaveBeenCalledTimes(1)
    expect(activeSubscriptions()).toBe(1)

    act(() => {
      authStateHandler?.('SIGNED_OUT', null)
    })
    expect(identityOf(second.result.current)).toEqual({ user: null, userId: null, ready: true })
    second.unmount()
  })

  test('ignores verification that resolves after unmount', async () => {
    const verified = deferred<GetUserResult>()
    mockGetUser.mockReturnValueOnce(verified.promise)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result, unmount } = renderAuth()
    await waitFor(() => expect(result.current.userId).toBe('user-from-session'))

    unmount()
    await act(async () => {
      verified.resolve({ data: { user: { id: 'user-from-session' } }, error: null })
      await verified.promise
    })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  test('useAuth throws outside AuthProvider', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider')
    errorSpy.mockRestore()
  })
})
