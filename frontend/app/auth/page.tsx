'use client'

/**
 * Auth page with Supabase pre-built Auth UI.
 * 
 * - Email/password sign in and sign up
 * - Redirects to /projects on successful auth
 */
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { createClient } from '@/lib/supabase/client'
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
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Transcription App</h1>
        <p className="auth-subtitle">Sign in to continue</p>

        <Auth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: 'var(--accent)',
                  brandAccent: '#2563eb',
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
        .auth-container {
          min-height: calc(100vh - 60px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          background: transparent;
        }
        
        .auth-card {
          width: 100%;
          max-width: 420px;
          padding: 2rem;
          background: color-mix(in oklab, var(--surface) 80%, transparent);
          border-radius: 14px;
          border: 1px solid var(--border);
          box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.15);
          backdrop-filter: blur(14px);
        }
        
        .auth-title {
          font-size: 1.625rem;
          font-weight: 600;
          color: var(--text);
          text-align: center;
          margin-bottom: 0.5rem;
          font-family: var(--font-serif);
          font-style: italic;
          letter-spacing: -0.01em;
        }
        
        .auth-subtitle {
          color: var(--muted);
          text-align: center;
          margin-bottom: 1.5rem;
          font-size: 0.95rem;
        }

        /* Override Supabase Auth UI styles for better theme integration */
        .auth-card input {
          background-color: color-mix(in oklab, var(--surface) 90%, transparent) !important;
          color: var(--text) !important;
          border-color: var(--border) !important;
        }
        
        .auth-card input::placeholder {
          color: var(--muted) !important;
        }
        
        .auth-card input:focus {
          border-color: var(--accent) !important;
          box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent) 25%, transparent) !important;
        }
        
        .auth-card label {
          color: var(--text) !important;
        }
        
        .auth-card a {
          color: var(--accent) !important;
        }
        
        .auth-card a:hover {
          color: var(--text) !important;
        }
      `}</style>
    </div>
  )
}
