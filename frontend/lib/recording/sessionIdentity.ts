/**
 * Identity seam for the recording session.
 *
 * Keeps `lib/recording` auth-agnostic: it must not import the Supabase client
 * (that would couple a pure, node-testable state module to infra). Instead the
 * client-side provider pushes the authenticated identity in via `setIdentity`,
 * and session actions read it back via `getIdentity` to scope persisted sessions
 * and recovery to the current user.
 */

export interface RecordingIdentity {
  /** Authenticated user id, or null when signed out / not yet known. */
  userId: string | null
  /** True once the first auth check has resolved (see useAuthIdentity). */
  ready: boolean
}

let currentIdentity: RecordingIdentity = { userId: null, ready: false }

export function setIdentity(identity: RecordingIdentity): void {
  currentIdentity = identity
}

export function getIdentity(): RecordingIdentity {
  return currentIdentity
}

export function __resetIdentityForTesting(): void {
  currentIdentity = { userId: null, ready: false }
}
