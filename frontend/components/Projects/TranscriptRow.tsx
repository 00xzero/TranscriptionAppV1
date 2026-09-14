'use client'

import type { ReactNode } from 'react'
import type { Transcript } from '@/contracts/db'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { formatDuration, formatRelativeTime } from './format'

interface TranscriptRowProps {
  transcript: Transcript
  actions?: ReactNode
}

function statusBadge(status: Transcript['status']) {
  switch (status) {
    case 'queued':
    case 'processing':
      return {
        label: 'Processing',
        className:
          'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700',
      }
    case 'error':
      return {
        label: 'Error',
        className:
          'text-ember-red bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700',
      }
    default:
      return null
  }
}

export function TranscriptRow({ transcript, actions }: TranscriptRowProps) {
  const title = transcript.title || 'Untitled'
  const isCompleted = transcript.status === 'completed'
  const badge = statusBadge(transcript.status)
  const duration = formatDuration(transcript.duration_seconds)

  return (
    <div
      data-testid={`transcript-row-${transcript.id}`}
      className="group flex min-h-18 items-center justify-between p-4 transition-colors hover:bg-subtle"
    >
      <Link
        href={isCompleted ? `/editor/${transcript.id}` : '/transcripts'}
        title={isCompleted ? `Open ${title}` : `Open transcript list for ${title}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-4"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface text-foreground/40 dark:bg-subtle">
          <span className="font-mono text-lg">¶</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-sans text-sm font-medium text-ink transition-colors group-hover:text-trust-blue dark:text-paper">
              {title}
            </p>
            {badge && (
              <span
                className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] ${badge.className}`}
              >
                {badge.label}
              </span>
            )}
          </div>
          <p className="font-mono text-[10px] text-ink/50 dark:text-paper/50">
            {duration || 'Duration unknown'}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-4">
        <span className="hidden font-sans text-xs text-ink/60 md:block dark:text-paper/60">
          {formatRelativeTime(transcript.updated_at)}
        </span>
        {actions}
      </div>
    </div>
  )
}
