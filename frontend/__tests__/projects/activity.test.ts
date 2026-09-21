import {
  rankProjectsByActivity,
  selectRecentProjects,
  type RecentProjectScope,
} from '@/core/projects/activity'
import { buildProjectTree } from '@/core/projects/tree'
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

describe('selectRecentProjects', () => {
  const root = (id: string, updatedAt: string, parentId: string | null = null): Project => ({
    ...project(id, updatedAt),
    parent_id: parentId,
  })

  const treeOf = (projects: Project[]) => buildProjectTree(projects)

  const select = (
    scope: RecentProjectScope,
    projects: Project[],
    transcripts: Transcript[],
    limit = 6
  ) =>
    selectRecentProjects({ scope, tree: treeOf(projects), projects, transcripts, limit })

  test('emits ground-level projects only, never nested ones', () => {
    const projects = [root('root', '2026-09-01T00:00:00Z'), root('child', '2026-09-09T00:00:00Z', 'root')]

    const cards = select('top-level', projects, [])

    expect(cards.map((card) => card.project.id)).toEqual(['root'])
    expect(cards[0].parentPath).toBeNull()
    expect(cards[0].countsAreBranchTotals).toBe(true)
  })

  test('lifts a root by its descendant project activity', () => {
    const projects = [
      root('quiet', '2026-09-05T00:00:00Z'),
      root('stale-parent', '2026-09-01T00:00:00Z'),
      root('busy-child', '2026-09-20T00:00:00Z', 'stale-parent'),
    ]

    expect(select('top-level', projects, []).map((card) => card.project.id)).toEqual([
      'stale-parent',
      'quiet',
    ])
  })

  test('lifts a root by transcript activity anywhere in its branch', () => {
    const projects = [
      root('quiet', '2026-09-05T00:00:00Z'),
      root('parent', '2026-09-01T00:00:00Z'),
      root('child', '2026-09-02T00:00:00Z', 'parent'),
    ]
    const transcripts = [transcript('t1', 'child', '2026-09-25T00:00:00Z')]

    const cards = select('top-level', projects, transcripts)

    expect(cards.map((card) => card.project.id)).toEqual(['parent', 'quiet'])
    expect(cards[0].lastActivityAt).toBe('2026-09-25T00:00:00Z')
  })

  test('totals transcripts and nested projects across the active branch', () => {
    const projects = [
      root('parent', '2026-09-01T00:00:00Z'),
      root('child', '2026-09-02T00:00:00Z', 'parent'),
      root('grandchild', '2026-09-03T00:00:00Z', 'child'),
    ]
    const transcripts = [
      transcript('t1', 'parent', '2026-09-04T00:00:00Z'),
      transcript('t2', 'child', '2026-09-05T00:00:00Z'),
      transcript('t3', 'grandchild', '2026-09-06T00:00:00Z'),
    ]

    const [card] = select('top-level', projects, transcripts)

    expect(card.transcriptCount).toBe(3)
    expect(card.nestedProjectCount).toBe(2)
  })

  test('ignores deleting roots, deleting descendants and their transcripts', () => {
    const deletingAt = '2026-09-15T00:00:00Z'
    const projects = [
      { ...root('gone', '2026-09-30T00:00:00Z'), deleting_at: deletingAt },
      root('kept', '2026-09-01T00:00:00Z'),
      { ...root('doomed-child', '2026-09-29T00:00:00Z', 'kept'), deleting_at: deletingAt },
    ]
    const transcripts = [
      transcript('t1', 'kept', '2026-09-02T00:00:00Z'),
      transcript('t2', 'doomed-child', '2026-09-28T00:00:00Z'),
    ]

    const cards = select('top-level', projects, transcripts)

    expect(cards.map((card) => card.project.id)).toEqual(['kept'])
    expect(cards[0].transcriptCount).toBe(1)
    expect(cards[0].nestedProjectCount).toBe(0)
    expect(cards[0].lastActivityAt).toBe('2026-09-02T00:00:00Z')
  })

  test('caps the result and breaks ties on id', () => {
    const projects = Array.from({ length: 8 }, (_unused, index) =>
      root(`p${index}`, '2026-09-01T00:00:00Z')
    )

    const cards = select('top-level', projects, [], 6)

    expect(cards).toHaveLength(6)
    expect(cards.map((card) => card.project.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
    expect(select('top-level', projects, [], 0)).toEqual([])
  })

  test("'all' keeps nested cards, direct counts and parent paths", () => {
    const projects = [
      root('parent', '2026-09-01T00:00:00Z'),
      root('child', '2026-09-09T00:00:00Z', 'parent'),
    ]
    const transcripts = [transcript('t1', 'child', '2026-09-02T00:00:00Z')]

    const cards = select('all', projects, transcripts)

    expect(cards.map((card) => card.project.id)).toEqual(['child', 'parent'])
    const childCard = cards[0]
    expect(childCard.parentPath).toBe('parent')
    expect(childCard.transcriptCount).toBe(1)
    expect(childCard.countsAreBranchTotals).toBe(false)
    expect(cards[1].transcriptCount).toBe(0)
    expect(cards[1].nestedProjectCount).toBe(1)
  })

  test("'all' excludes deleting descendants from nested project counts", () => {
    const deletingAt = '2026-09-15T00:00:00Z'
    const projects = [
      root('parent', '2026-09-01T00:00:00Z'),
      root('kept-child', '2026-09-02T00:00:00Z', 'parent'),
      { ...root('doomed-child', '2026-09-03T00:00:00Z', 'parent'), deleting_at: deletingAt },
    ]

    const cards = select('all', projects, [])

    expect(cards.find((card) => card.project.id === 'parent')?.nestedProjectCount).toBe(1)
  })
})
