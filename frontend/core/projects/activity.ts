import type { Project, Transcript } from '@/contracts/db'

export type ProjectActivity = {
  project: Project
  lastActivityAt: string
}

export function rankProjectsByActivity(
  projects: Project[],
  transcripts: Transcript[],
  limit: number
): ProjectActivity[] {
  if (limit <= 0) return []

  const latestTranscriptActivity = new Map<string, string>()
  for (const transcript of transcripts) {
    if (!transcript.project_id) continue
    const current = latestTranscriptActivity.get(transcript.project_id)
    if (!current || Date.parse(transcript.updated_at) > Date.parse(current)) {
      latestTranscriptActivity.set(transcript.project_id, transcript.updated_at)
    }
  }

  return projects
    .filter((project) => !project.deleting_at)
    .map((project) => {
      const transcriptActivity = latestTranscriptActivity.get(project.id)
      const lastActivityAt =
        transcriptActivity && Date.parse(transcriptActivity) > Date.parse(project.updated_at)
          ? transcriptActivity
          : project.updated_at
      return { project, lastActivityAt }
    })
    .sort((a, b) => {
      const byActivity = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
      return byActivity || a.project.id.localeCompare(b.project.id)
    })
    .slice(0, limit)
}
