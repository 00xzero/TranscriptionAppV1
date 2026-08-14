'use client'

/**
 * Auth page with Supabase pre-built Auth UI.
 * 
 * - Email/password sign in and sign up
 * - Redirects to / (Library) on successful auth
 */
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { createClient } from '@/infra/supabase/client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthChangeEvent } from '@supabase/supabase-js'

// Create client at module scope to prevent subscription churn on re-renders
const supabase = createClient()

export default function AuthPage() {
  const router = useRouter()

  useEffect(() => {
    // Check for existing session on mount
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.push('/')
        router.refresh()
      }
    }
    checkSession()

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session) => {
      if (event === 'SIGNED_IN' && session) {
        router.push('/')
        router.refresh()
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  return (
    <div className="min-h-[calc(100vh-60px)] flex items-center justify-center p-8 bg-transparent">
      <div
        data-auth-panel
        className="w-full max-w-[420px] p-8 rounded-[14px] border border-(--border) [background:color-mix(in_oklab,var(--surface)_80%,transparent)] shadow-elevation backdrop-blur-[14px]"
      >
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="flex items-center gap-1.5">
            <div className="h-6 w-1 bg-(--text) rounded-full"></div>
            <div className="h-2 w-2 bg-(--brand-red) rounded-xs"></div>
          </div>
          <h1 className="text-[1.625rem] font-normal text-(--text) font-serif italic tracking-[-0.02em]">olivetti</h1>
        </div>
        <p className="text-[0.95rem] text-(--muted) text-center mb-6">Sign in to continue</p>

        <Auth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: 'var(--accent)',
                  brandAccent: 'color-mix(in oklab, var(--accent) 85%, black)',
                  inputBackground: 'var(--surface)',
                  inputText: 'var(--text)',
                  inputBorder: 'var(--border)',
                  inputBorderFocus: 'var(--accent)',
                  inputBorderHover: 'var(--muted)',
                }
              }
            },
            className: {
              container: 'auth-ui-container',
              button: 'auth-ui-button',
              input: 'auth-ui-input',
            }
          }}
          providers={[]}
          view="sign_in"
          showLinks={true}
          redirectTo={`${typeof window !== 'undefined' ? window.location.origin : ''}/`}
        />
      </div>

      <style jsx global>{`
        /* Override Supabase Auth UI styles for better theme integration */
        [data-auth-panel] input {
          background-color: color-mix(in oklab, var(--surface) 90%, transparent) !important;
          color: var(--text) !important;
          border-color: var(--border) !important;
        }
        
        [data-auth-panel] input::placeholder {
          color: var(--muted) !important;
        }
        
        [data-auth-panel] input:focus {
          border-color: var(--accent) !important;
          box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent) 25%, transparent) !important;
        }
        
        [data-auth-panel] label {
          color: var(--text) !important;
        }
        
        [data-auth-panel] a {
          color: var(--accent) !important;
        }
        
        [data-auth-panel] a:hover {
          color: var(--text) !important;
        }
      `}</style>
    </div>
  )
}
