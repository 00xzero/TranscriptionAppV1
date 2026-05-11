"use client"

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Global error boundary caught:', error)
  }, [error])

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="m-0 flex min-h-screen items-center justify-center bg-paper p-6 font-sans text-ink">
        <div
          role="alert"
          aria-live="assertive"
          className="w-full max-w-[560px] text-center"
        >
          <div
            aria-label="Olivetti"
            className="m-0 inline-flex items-center gap-2.5 font-serif text-[32px] italic leading-none tracking-tight text-ink"
          >
            <span
              aria-hidden="true"
              className="inline-flex shrink-0 items-center gap-1.5"
            >
              <span className="block h-[30px] w-[5px] rounded-full bg-ink" />
              <span className="block h-2.5 w-2.5 rounded-[2px] bg-ember-red" />
            </span>
            <span>olivetti</span>
          </div>
          <h1 className="mb-0 mt-3.5 font-serif text-[56px] font-medium leading-[1.05] tracking-tight text-ink">
            Something went wrong
          </h1>
          <p className="mb-0 mt-6 text-base leading-relaxed text-muted">
            The application failed to load. Please try again.
          </p>
          {error.digest && (
            <p className="mb-0 mt-4 font-mono text-xs text-muted">
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-10 cursor-pointer rounded-full border-0 bg-ember-red px-7 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
