"use client"

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Global error boundary caught:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#E4E1D9',
          color: '#1D1E18',
          fontFamily: 'ui-sans-serif, -apple-system, Inter, sans-serif',
          padding: '24px',
        }}
      >
        <div
          role="alert"
          aria-live="assertive"
          style={{
            width: '100%',
            maxWidth: '560px',
            textAlign: 'center',
          }}
        >
          <div
            aria-label="Olivetti"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              fontFamily: 'ui-serif, Georgia, serif',
              fontStyle: 'italic',
              fontSize: '32px',
              lineHeight: 1,
              margin: 0,
              color: '#1D1E18',
              letterSpacing: '-0.02em',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                flex: '0 0 auto',
              }}
            >
              <span
                style={{
                  width: '5px',
                  height: '30px',
                  borderRadius: '9999px',
                  backgroundColor: '#1D1E18',
                  display: 'block',
                }}
              />
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  backgroundColor: '#C73E1D',
                  display: 'block',
                }}
              />
            </span>
            <span>olivetti</span>
          </div>
          <h1
            style={{
              marginTop: '14px',
              marginBottom: 0,
              fontFamily: 'ui-serif, Georgia, serif',
              fontWeight: 500,
              fontSize: '56px',
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              color: '#1D1E18',
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              marginTop: '24px',
              marginBottom: 0,
              fontSize: '16px',
              lineHeight: 1.6,
              color: '#6F6B63',
            }}
          >
            The application failed to load. Please try again.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: '16px',
                marginBottom: 0,
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: '12px',
                color: '#6F6B63',
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '40px',
              padding: '12px 28px',
              borderRadius: '9999px',
              backgroundColor: '#C73E1D',
              color: '#E4E1D9',
              border: 'none',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
