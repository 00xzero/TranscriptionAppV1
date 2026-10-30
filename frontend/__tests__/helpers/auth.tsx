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
import type { AppUser, AuthContextValue } from '@/lib/auth/AuthProvider'

export interface TestAuthIdentity {
  user?: AppUser | null
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

/** Minimal `AppUser` for account-name assertions. */
export function testUser(overrides: Partial<AppUser> = {}): AppUser {
  return { email: '', name: null, ...overrides }
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
