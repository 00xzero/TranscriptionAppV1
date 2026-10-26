/**
 * Test double for `@workos-inc/authkit-nextjs/components`. Mapped in
 * jest.config.js. Signed out and settled by default. Suites change the
 * session with `setAuthKitState(...)`, which rerenders every `useAuth()`
 * consumer, as a real sign-in, sign-out or account switch would.
 */
import { useSyncExternalStore, type ReactNode } from 'react'

export interface MockWorkosUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

interface AuthKitState {
  user: MockWorkosUser | null
  loading: boolean
}

const SIGNED_OUT: AuthKitState = { user: null, loading: false }

let state: AuthKitState = SIGNED_OUT
const listeners = new Set<() => void>()

export function setAuthKitState(next: Partial<AuthKitState>): void {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

export function resetAuthKitState(): void {
  state = SIGNED_OUT
  mockSignOut.mockReset()
  mockSignOut.mockResolvedValue(undefined)
  mockGetAccessToken.mockReset()
  mockGetAccessToken.mockResolvedValue(undefined)
  mockRefreshAuth.mockReset()
  mockRefreshAuth.mockResolvedValue(undefined)
}

/** A WorkOS user for `setAuthKitState({ user })`. */
export function workosUser(id: string, overrides: Partial<MockWorkosUser> = {}): MockWorkosUser {
  return { id, email: '', firstName: null, lastName: null, ...overrides }
}

export const mockSignOut = jest.fn(async (_options?: { returnTo?: string }) => undefined)
export const mockGetAccessToken = jest.fn(async (): Promise<string | undefined> => undefined)
/** AuthKit re-reads the session's user; a suite makes it land with `setAuthKitState`. */
export const mockRefreshAuth = jest.fn(async (): Promise<void> => undefined)

/** A JWT-shaped access token for `sub` (unsigned: only its subject is read). */
export function accessTokenFor(sub: string): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '')
  return `${encode({ alg: 'none' })}.${encode({ sub })}.signature`
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const AuthKitProvider = ({ children }: { children: ReactNode }) => children

export function useAuth() {
  const current = useSyncExternalStore(subscribe, () => state, () => state)
  return { ...current, signOut: mockSignOut, refreshAuth: mockRefreshAuth }
}

export function useAccessToken() {
  return { getAccessToken: mockGetAccessToken }
}
