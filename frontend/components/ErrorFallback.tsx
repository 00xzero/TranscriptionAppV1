"use client"

import Link from 'next/link'

type Action =
  | { kind: 'button'; label: string; onClick: () => void }
  | { kind: 'link'; label: string; href: string }

interface ErrorFallbackProps {
  eyebrow?: string
  title: string
  description: string
  digest?: string
  primary: Action
  secondary?: Action
}

function renderAction(action: Action, isPrimary: boolean) {
  const primaryClasses =
    'inline-flex items-center justify-center rounded-full bg-ember-red px-7 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper dark:focus-visible:ring-offset-night-surface'
  const secondaryClasses =
    'text-sm text-trust-blue hover:underline focus:outline-none focus-visible:underline'
  const classes = isPrimary ? primaryClasses : secondaryClasses

  if (action.kind === 'button') {
    return (
      <button type="button" onClick={action.onClick} className={classes}>
        {action.label}
      </button>
    )
  }
  return (
    <Link href={action.href} className={classes}>
      {action.label}
    </Link>
  )
}

export function ErrorFallback({
  eyebrow,
  title,
  description,
  digest,
  primary,
  secondary,
}: ErrorFallbackProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      // 56px keeps route-level fallbacks clear of the fixed contextual header.
      className="min-h-full pt-[56px] pb-16 flex items-center justify-center px-6"
    >
      <div className="w-full max-w-xl text-center">
        {eyebrow && (
          <p className="font-serif text-3xl italic text-muted md:text-4xl">
            {eyebrow}
          </p>
        )}
        <h1
          className={`${eyebrow ? 'mt-5' : ''} font-serif text-5xl md:text-6xl text-ink dark:text-paper leading-[1.05] tracking-tight`}
        >
          {title}
        </h1>
        <p className="mt-6 text-base text-muted leading-relaxed">{description}</p>
        {digest && (
          <p className="mt-4 font-mono text-xs text-muted">Reference: {digest}</p>
        )}
        <div className="mt-10 flex items-center justify-center gap-6">
          {renderAction(primary, true)}
          {secondary && renderAction(secondary, false)}
        </div>
      </div>
    </div>
  )
}
