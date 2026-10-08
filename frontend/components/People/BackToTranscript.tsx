'use client'

import { ArrowLeft } from 'lucide-react'
import { useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'

/**
 * ← Back to "<transcript title>" on a People page opened from the editor
 * (spec §4). Until transcripts load it names no title; once they have, a
 * transcript that no longer exists shows no link.
 */
export function BackToTranscript({ from }: { from: string | null }) {
  const { transcripts, transcriptsLoading } = useTranscriptsData()
  if (!from) return null
  const transcript = transcripts.find((row) => row.id === from)
  if (!transcript && !transcriptsLoading) return null

  return (
    <Link
      href={`/editor/${from}`}
      className="mb-4 inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm text-trust-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/60"
    >
      <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {transcript ? `Back to “${transcript.title || 'Untitled'}”` : 'Back to transcript'}
      </span>
    </Link>
  )
}
