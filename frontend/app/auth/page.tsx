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

// Create client at module scope to prevent subscription churn on re-renders
const supabase = createClient()

export default function AuthPage() {
  const router = useRouter()

  useEffect(() => {
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === 'SIGNED_IN') {
        router.push('/projects')
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
          redirectTo={`${typeof window !== 'undefined' ? window.location.origin : ''}/projects`}
        />
      </div>

      <style jsx global>{`
        .auth-container {
          min-height: calc(100vh - 60px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          background: var(--bg);
        }
        
        .auth-card {
          width: 100%;
          max-width: 400px;
          padding: 2rem;
          background: var(--surface);
          border-radius: 12px;
          border: 1px solid var(--border);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
        }
        
        .auth-title {
          font-size: 1.5rem;
          font-weight: 600;
          color: var(--text);
          text-align: center;
          margin-bottom: 0.5rem;
        }
        
        .auth-subtitle {
          color: var(--muted);
          text-align: center;
          margin-bottom: 1.5rem;
        }

        /* Override Supabase Auth UI styles for better theme integration */
        .auth-card input {
          background-color: var(--surface) !important;
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
