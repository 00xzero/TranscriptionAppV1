import type { Transcript } from '@/contracts/db'

export type TranscriptActionTarget = Pick<Transcript, 'id' | 'project_id'> & { title: string }

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
