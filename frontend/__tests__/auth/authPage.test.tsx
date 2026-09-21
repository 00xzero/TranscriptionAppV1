import React from 'react'
import { render } from '@testing-library/react'
import { setTestAuth } from '@/__tests__/helpers/auth'

const routerPushMock = jest.fn()
const routerRefreshMock = jest.fn()
// Next's router instance is stable across renders; mirror that.
const mockRouter = { push: routerPushMock, refresh: routerRefreshMock }

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

jest.mock('@supabase/auth-ui-react', () => ({
  Auth: () => <div data-testid="auth-ui" />,
}))

jest.mock('@supabase/auth-ui-shared', () => ({ ThemeSupa: {} }))

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({ auth: {} }),
}))

jest.mock('@/lib/auth/AuthProvider', () => require('@/__tests__/helpers/auth').authProviderMock)

import AuthPage from '@/app/auth/page'

describe('AuthPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('stays put while identity is unresolved or signed out', () => {
    setTestAuth({ userId: null, ready: false })
    const { rerender } = render(<AuthPage />)
    setTestAuth({ userId: null, ready: true })
    rerender(<AuthPage />)

    expect(routerPushMock).not.toHaveBeenCalled()
  })

  test('redirects home as soon as a cached identity appears, before verification', () => {
    setTestAuth({ userId: null, ready: false })
    const { rerender } = render(<AuthPage />)

    setTestAuth({ userId: 'user-a', ready: false })
    rerender(<AuthPage />)

    expect(routerPushMock).toHaveBeenCalledTimes(1)
    expect(routerPushMock).toHaveBeenCalledWith('/')
    expect(routerRefreshMock).toHaveBeenCalledTimes(1)
  })

  test('redirects once per identity transition, not on verification of the same user', () => {
    setTestAuth({ userId: 'user-a', ready: false })
    const { rerender } = render(<AuthPage />)
    setTestAuth({ userId: 'user-a', ready: true })
    rerender(<AuthPage />)

    expect(routerPushMock).toHaveBeenCalledTimes(1)
  })
})
