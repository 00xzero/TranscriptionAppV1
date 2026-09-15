import type { Transcript } from '@/contracts/db'

export type TranscriptActionTarget = {
  id: string
  title: string
  project_id: string | null
}

export function transcriptActionTarget(
  transcript: Pick<Transcript, 'id' | 'title' | 'project_id'>,
  fallbackTitle = 'Untitled'
): TranscriptActionTarget {
  return {
    id: transcript.id,
    title: transcript.title || fallbackTitle,
    project_id: transcript.project_id,
  }
}
