import type { Project, Transcript } from '@/contracts/db'
import {
  activeBranchIds,
  descendantCount,
  pathLabel,
  transcriptCountsByProject,
  type ProjectTree,
} from './tree'

export type ProjectActivity = {
  project: Project
  lastActivityAt: string
}

/** Which projects the dashboard's Recent Projects rail is allowed to surface. */
export type RecentProjectScope = 'top-level' | 'all'

export type RecentProjectCardData = {
  project: Project
  lastActivityAt: string
  transcriptCount: number
  nestedProjectCount: number
  parentPath: string | null
  /** True when the counts roll up a whole branch rather than the project alone. */
  countsAreBranchTotals: boolean
}

const newest = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a)

function latestTranscriptActivityByProject(transcripts: Transcript[]): Map<string, string> {
  const latest = new Map<string, string>()
  for (const transcript of transcripts) {
    if (!transcript.project_id) continue
    const current = latest.get(transcript.project_id)
    latest.set(
      transcript.project_id,
      current ? newest(current, transcript.updated_at) : transcript.updated_at
    )
  }
  return latest
}

const byActivityThenId = (a: RecentProjectCardData, b: RecentProjectCardData) => {
  const byActivity = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
  return byActivity || a.project.id.localeCompare(b.project.id)
}

export function rankProjectsByActivity(
  projects: Project[],
  transcripts: Transcript[],
  limit: number
): ProjectActivity[] {
  if (limit <= 0) return []

  const latestTranscriptActivity = latestTranscriptActivityByProject(transcripts)

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

/**
 * Ranks ground-level projects by the newest activity anywhere in their active branch.
 *
 * Candidates come from `tree.roots` rather than a `parent_id === null` test so the
 * dashboard agrees with the Projects page about what counts as ground level: a project
 * whose parent is absent from the fetched set is a root in both views.
 */
function rankRootsByBranchActivity(
  tree: ProjectTree,
  transcripts: Transcript[],
  limit: number
): RecentProjectCardData[] {
  const latestTranscriptActivity = latestTranscriptActivityByProject(transcripts)
  const transcriptCounts = transcriptCountsByProject(transcripts)

  return tree.roots
    .filter((project) => !project.deleting_at)
    .map((project) => {
      const branch = activeBranchIds(tree, project.id)
      let lastActivityAt = project.updated_at
      let transcriptCount = 0

      for (const id of branch) {
        const node = tree.byId.get(id)
        if (node) lastActivityAt = newest(lastActivityAt, node.updated_at)

        transcriptCount += transcriptCounts.get(id) ?? 0
        const transcriptActivity = latestTranscriptActivity.get(id)
        if (transcriptActivity) lastActivityAt = newest(lastActivityAt, transcriptActivity)
      }

      return {
        project,
        lastActivityAt,
        transcriptCount,
        nestedProjectCount: Math.max(0, branch.length - 1),
        parentPath: null,
        countsAreBranchTotals: true,
      }
    })
    .sort(byActivityThenId)
    .slice(0, limit)
}

export function selectRecentProjects({
  scope,
  tree,
  projects,
  transcripts,
  limit,
}: {
  scope: RecentProjectScope
  tree: ProjectTree
  projects: Project[]
  transcripts: Transcript[]
  limit: number
}): RecentProjectCardData[] {
  if (limit <= 0) return []
  if (scope === 'top-level') return rankRootsByBranchActivity(tree, transcripts, limit)

  const transcriptCounts = transcriptCountsByProject(transcripts)
  return rankProjectsByActivity(projects, transcripts, limit).map(
    ({ project, lastActivityAt }) => ({
      project,
      lastActivityAt,
      transcriptCount: transcriptCounts.get(project.id) ?? 0,
      nestedProjectCount: descendantCount(tree, project.id),
      parentPath: project.parent_id ? pathLabel(tree, project.parent_id) : null,
      countsAreBranchTotals: false,
    })
  )
}
