'use client'

/**
 * Auth status component for the header.
 * Shows sign out button when authenticated, nothing when on auth page.
 */
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'

export default function AuthStatus() {
    const supabase = createClient()
    const pathname = usePathname()
    const router = useRouter()
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Get initial user
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            setUser(user)
            setLoading(false)
        }
        getUser()

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
            setUser(session?.user ?? null)
        })

        return () => subscription.unsubscribe()
    }, [supabase])

    // Don't show on auth page
    if (pathname?.startsWith('/auth')) {
        return null
    }

    // Don't show while loading
    if (loading) {
        return null
    }

    // Don't show if not authenticated
    if (!user) {
        return null
    }

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        router.push('/auth')
        router.refresh()
    }

    return (
        <div className="auth-status">
            <span className="user-email">{user.email}</span>
            <button onClick={handleSignOut} className="sign-out-button">
                Sign Out
            </button>

            <style jsx>{`
        .auth-status {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        
        .user-email {
          font-size: 0.875rem;
          color: var(--text-muted);
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .sign-out-button {
          padding: 0.375rem 0.75rem;
          font-size: 0.875rem;
          color: var(--text-muted);
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .sign-out-button:hover {
          color: var(--text);
          border-color: var(--text-muted);
        }
      `}</style>
        </div>
    )
}
