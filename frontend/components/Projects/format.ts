import type { ProjectTree } from '@/core/projects/tree'
import { collapsedPathLabel, pathLabel } from '@/core/projects/tree'

/** What a transcript row shows for its project: the elided path, plus the full one for a tooltip. */
export type TranscriptProjectLabel = { label: string; full: string }

const UNFILED: TranscriptProjectLabel = { label: 'Unfiled', full: 'Unfiled' }

/**
 * Transcripts with no project -- and those whose project is missing from the
 * fetched tree -- read as Unfiled, matching the Projects page's own section name.
 */
export function transcriptProjectLabel(
  tree: ProjectTree,
  projectId: string | null
): TranscriptProjectLabel {
  if (!projectId) return UNFILED
  const label = collapsedPathLabel(tree, projectId)
  if (!label) return UNFILED
  return { label, full: pathLabel(tree, projectId) }
}

export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function formatRelativeTime(dateString: string): string {
  const timestamp = Date.parse(dateString)
  if (!Number.isFinite(timestamp)) return 'Unknown'

  const diffMs = Date.now() - timestamp
  if (diffMs < 60_000) return 'Just now'

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null

  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) {
    const wholeSeconds = Math.floor(seconds)
    if (wholeSeconds < 1) return '< 1 sec'
    return wholeSeconds === 1 ? '1 sec' : `${wholeSeconds} sec`
  }

  if (minutes < 60) return minutes === 1 ? '1 min' : `${minutes} mins`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) return `${hours} hr`
  return `${hours} hr ${remainingMinutes === 1 ? '1 min' : `${remainingMinutes} mins`}`
}
