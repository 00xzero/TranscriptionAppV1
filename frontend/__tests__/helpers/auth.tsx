/**
 * Shared test double for `@/lib/auth/AuthProvider`.
 *
 * Usage in a suite:
 *
 *   jest.mock('@/lib/auth/AuthProvider', () => require('@/__tests__/helpers/auth').authProviderMock)
 *   import { setTestAuth, resetTestAuth } from '@/__tests__/helpers/auth'
 *
 * `useAuth()` reads the current identity on every render, so a suite can call
 * `setTestAuth(...)` and then rerender to simulate an auth change.
 */
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AuthContextValue } from '@/lib/auth/AuthProvider'

export interface TestAuthIdentity {
  user?: User | null
  userId: string | null
  ready: boolean
}

const DEFAULT_IDENTITY: TestAuthIdentity = { user: null, userId: null, ready: false }

let currentIdentity: TestAuthIdentity = DEFAULT_IDENTITY

export const mockSignOut = jest.fn(async () => undefined)

export function setTestAuth(identity: TestAuthIdentity): void {
  currentIdentity = identity
}

export function resetTestAuth(): void {
  currentIdentity = DEFAULT_IDENTITY
  mockSignOut.mockReset()
  mockSignOut.mockImplementation(async () => undefined)
}

/** Minimal Supabase `User` for account-metadata assertions. */
export function testUser(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  } as User
}

export function useTestAuth(): AuthContextValue {
  return {
    user: currentIdentity.user ?? null,
    userId: currentIdentity.userId,
    ready: currentIdentity.ready,
    signOut: mockSignOut,
  }
}

export const authProviderMock = {
  useAuth: useTestAuth,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}
