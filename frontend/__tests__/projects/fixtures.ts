import type { Project, Transcript } from '@/contracts/db'
import { buildProjectTree } from '@/core/projects/tree'

const TIMESTAMP = '2026-09-01T12:00:00Z'

export const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-a',
  user_id: 'user-1',
  parent_id: null,
  name: 'Project A',
  deleting_at: null,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
  ...overrides,
})

export const makeTranscript = (overrides: Partial<Transcript> = {}): Transcript => ({
  id: 'transcript-a',
  user_id: 'user-1',
  project_id: null,
  title: 'Transcript A',
  status: 'completed',
  source_object_key: null,
  upload_intent_id: null,
  duration_seconds: 120,
  waveform_object_key: null,
  waveform_status: 'skipped',
  waveform_points_per_second: null,
  waveform_version: null,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
  ...overrides,
})

/** The subset of `useProjectsData()` the Projects pages read, settled and error-free. */
export function providerData(projects: Project[], transcripts: Transcript[]) {
  return {
    projects,
    tree: buildProjectTree(projects),
    projectsLoading: false,
    projectError: null,
    refetchProjects: jest.fn().mockResolvedValue(undefined),
    createProject: jest.fn(),
    renameProject: jest.fn(),
    mutateProjects: jest.fn(),
    transcripts,
    transcriptsLoading: false,
    transcriptError: null,
    refetchTranscripts: jest.fn().mockResolvedValue(undefined),
    deleteTranscript: jest.fn().mockResolvedValue({ cleanupPendingKeys: [] }),
    moveTranscript: jest.fn(),
    addTranscripts: jest.fn(),
    mutateTranscripts: jest.fn(),
  }
}

/** Project and transcript row test ids in document order. */
export function rowTestIds(container: HTMLElement) {
  return [
    ...container.querySelectorAll('[data-testid^="project-row-"], [data-testid^="transcript-row-"]'),
  ].map((row) => row.getAttribute('data-testid'))
}
