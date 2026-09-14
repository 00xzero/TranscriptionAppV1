import { rankProjectsByActivity } from '@/core/projects/activity'
import type { Project, Transcript } from '@/contracts/db'

const project = (id: string, updatedAt: string, deletingAt: string | null = null): Project => ({
  id,
  user_id: '00000000-0000-4000-8000-000000000001',
  parent_id: null,
  name: id,
  deleting_at: deletingAt,
  created_at: updatedAt,
  updated_at: updatedAt,
})

const transcript = (id: string, projectId: string, updatedAt: string): Transcript => ({
  id,
  user_id: '00000000-0000-4000-8000-000000000001',
  project_id: projectId,
  title: id,
  status: 'completed',
  source_object_key: null,
  upload_intent_id: null,
  duration_seconds: null,
  waveform_object_key: null,
  waveform_status: 'skipped',
  waveform_points_per_second: null,
  waveform_version: null,
  created_at: updatedAt,
  updated_at: updatedAt,
})

test('ranks projects by their own or direct transcript activity and excludes deleting rows', () => {
  const projects = [
    project('own', '2026-09-04T00:00:00Z'),
    project('transcript', '2026-09-01T00:00:00Z'),
    project('old', '2026-08-01T00:00:00Z'),
    project('deleting', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z'),
  ]
  const transcripts = [
    transcript('direct', 'transcript', '2026-09-05T00:00:00Z'),
    transcript('ignored-child', 'old', '2026-08-02T00:00:00Z'),
  ]

  expect(rankProjectsByActivity(projects, transcripts, 2)).toEqual([
    { project: projects[1], lastActivityAt: '2026-09-05T00:00:00Z' },
    { project: projects[0], lastActivityAt: '2026-09-04T00:00:00Z' },
  ])
  expect(rankProjectsByActivity(projects, transcripts, 0)).toEqual([])
})
