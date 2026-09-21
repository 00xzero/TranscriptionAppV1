'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/infra/supabase/client'

interface AuthIdentity {
  /** Verified Supabase user, or null when signed out or not yet verified. */
  user: User | null
  /** Current user id. A cached session may populate this before verification. */
  userId: string | null
  /**
   * True once Supabase has verified the current auth state. A cached browser
   * session may populate `userId` while this remains false; privacy-sensitive
   * callers (e.g. recording recovery) must wait for `ready`.
   */
  ready: boolean
}

export interface AuthContextValue extends AuthIdentity {
  /**
   * Sign out and clear identity immediately, without waiting for the
   * SIGNED_OUT event. Rethrows a Supabase sign-out error after clearing.
   */
  signOut: () => Promise<void>
}

const INITIAL_IDENTITY: AuthIdentity = { user: null, userId: null, ready: false }
const SIGNED_OUT_IDENTITY: AuthIdentity = { user: null, userId: null, ready: true }

export const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * App-wide owner of client auth identity: the single app-owned auth
 * subscription. Exposes a cached session user id early for low-risk UI
 * responsiveness, but only marks `ready` after getUser verifies the session
 * (or confirms there is no signed-in user). Every auth change after the
 * initial session supersedes any in-flight verification.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(createClient)
  const [identity, setIdentity] = useState<AuthIdentity>(INITIAL_IDENTITY)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    const isCurrent = (generation: number) =>
      mountedRef.current && generationRef.current === generation

    const loadIdentity = async () => {
      const loadGeneration = generationRef.current
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        if (!isCurrent(loadGeneration)) return
        const sessionUserId = sessionData.session?.user.id ?? null
        if (!sessionUserId) {
          setIdentity(SIGNED_OUT_IDENTITY)
          return
        }

        setIdentity({ user: null, userId: sessionUserId, ready: false })

        const { data, error } = await supabase.auth.getUser()
        if (!isCurrent(loadGeneration)) return
        if (error) {
          setIdentity({ user: null, userId: sessionUserId, ready: false })
          return
        }
        const user = data.user ?? null
        setIdentity({ user, userId: user?.id ?? null, ready: true })
      } catch {
        if (!isCurrent(loadGeneration)) return
        setIdentity(SIGNED_OUT_IDENTITY)
      }
    }

    void loadIdentity()

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mountedRef.current) return
      if (event === 'INITIAL_SESSION') {
        setIdentity((current) =>
          current.ready
            ? current
            : { user: null, userId: session?.user.id ?? null, ready: false }
        )
        return
      }
      generationRef.current += 1
      const user = session?.user ?? null
      setIdentity({ user, userId: user?.id ?? null, ready: true })
    })

    return () => {
      mountedRef.current = false
      generationRef.current += 1
      authListener.subscription.unsubscribe()
    }
  }, [supabase])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (mountedRef.current) {
      generationRef.current += 1
      setIdentity(SIGNED_OUT_IDENTITY)
    }
    if (error) throw error
  }, [supabase])

  const value = useMemo<AuthContextValue>(
    () => ({ ...identity, signOut }),
    [identity, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
