'use client'

import type { ReactNode } from 'react'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { formatRelativeTime } from './format'

export function ProjectList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-sm border border-border bg-panel">
      {children}
    </div>
  )
}

export function ListSectionHeading({ id, title, meta }: { id: string; title: string; meta: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between border-b border-border pb-2">
      <h2 id={id} className="font-serif text-2xl text-foreground">
        {title}
      </h2>
      <span className="font-mono text-xs text-muted">{meta}</span>
    </div>
  )
}

export function ProjectListSkeleton() {
  return (
    <ProjectList>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex min-h-18 animate-pulse items-center gap-4 p-4">
          <div className="h-10 w-10 rounded-sm bg-subtle" />
          <div className="space-y-2">
            <div className="h-3 w-36 rounded-sm bg-subtle" />
            <div className="h-2 w-52 rounded-sm bg-subtle" />
          </div>
        </div>
      ))}
    </ProjectList>
  )
}

interface ListRowProps {
  testId: string
  /** Omit to render the row's main area inert. */
  href?: string
  title?: string
  updatedAt: string
  actions?: ReactNode
  children: ReactNode
}

export function ListRow({ testId, href, title, updatedAt, actions, children }: ListRowProps) {
  const mainClassName = 'flex min-w-0 flex-1 items-center gap-4'

  return (
    <div
      data-testid={testId}
      className="group flex min-h-18 items-center justify-between p-4 transition-colors hover:bg-subtle"
    >
      {href ? (
        <Link href={href} title={title} className={mainClassName}>
          {children}
        </Link>
      ) : (
        <div className={mainClassName}>{children}</div>
      )}
      <div className="flex items-center gap-4">
        <span className="hidden font-sans text-xs text-ink/60 md:block dark:text-paper/60">
          {formatRelativeTime(updatedAt)}
        </span>
        {actions}
      </div>
    </div>
  )
}
