import {
  ancestorsOf,
  branchIds,
  buildProjectTree,
  collapseBreadcrumbs,
  descendantCount,
  pathLabel,
  siblingNameTaken,
  transcriptCountsByProject,
  transcriptsInProject,
} from '@/core/projects/tree'
import type { Project, Transcript } from '@/contracts/db'

const project = (id: string, name: string, parentId: string | null = null): Project => ({
  id,
  user_id: '00000000-0000-4000-8000-000000000001',
  parent_id: parentId,
  name,
  deleting_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
})

const transcript = (
  id: string,
  projectId: string | null,
  updatedAt: string
): Transcript => ({
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

describe('project tree helpers', () => {
  test('builds sorted roots and children and treats orphans as roots', () => {
    const tree = buildProjectTree([
      project('b', 'beta'),
      project('a', 'Alpha'),
      project('c', 'charlie', 'a'),
      project('d', 'Bravo', 'a'),
      project('orphan', 'Orphan', 'missing'),
    ])

    expect(tree.roots.map((item) => item.id)).toEqual(['a', 'b', 'orphan'])
    expect(tree.childrenOf.get('a')?.map((item) => item.id)).toEqual(['d', 'c'])
    expect(tree.byId.get('c')?.name).toBe('charlie')
  })

  test('returns paths and branch data in hierarchy order', () => {
    const tree = buildProjectTree([
      project('root', 'Work'),
      project('child', 'Client A', 'root'),
      project('leaf', 'Interviews', 'child'),
    ])

    expect(ancestorsOf(tree, 'leaf')?.map((item) => item.id)).toEqual(['root', 'child'])
    expect(ancestorsOf(tree, 'missing')).toBeNull()
    expect(branchIds(tree, 'root')).toEqual(['root', 'child', 'leaf'])
    expect(descendantCount(tree, 'root')).toBe(2)
    expect(pathLabel(tree, 'leaf')).toBe('Work / Client A / Interviews')
    expect(pathLabel(tree, 'missing')).toBe('')
  })

  test('never repeats nodes when malformed input contains a cycle', () => {
    const tree = buildProjectTree([
      project('a', 'A', 'b'),
      project('b', 'B', 'a'),
    ])

    expect(branchIds(tree, 'a')).toEqual(['a', 'b'])
    expect(ancestorsOf(tree, 'a')?.map((item) => item.id)).toEqual(['b'])
    expect(pathLabel(tree, 'a')).toBe('B / A')
  })

  test('checks normalized sibling names and supports rename exclusion', () => {
    const tree = buildProjectTree([
      project('root', ' Work '),
      project('child', 'Client A', 'root'),
    ])

    expect(siblingNameTaken(tree, null, 'work')).toBe(true)
    expect(siblingNameTaken(tree, 'root', ' client a ')).toBe(true)
    expect(siblingNameTaken(tree, 'root', 'CLIENT A', 'child')).toBe(false)
  })

  test('matches PostgreSQL lower(name) behavior for Unicode and case edges', () => {
    const tree = buildProjectTree([
      project('ascii', 'I'),
      project('dotted', 'İ'),
      project('accented', 'É'),
      project('eszett', 'ß'),
      project('sigma', 'Σ'),
    ])

    expect(siblingNameTaken(tree, null, 'i')).toBe(true)
    expect(siblingNameTaken(tree, null, 'i̇')).toBe(true)
    expect(siblingNameTaken(tree, null, 'é')).toBe(true)
    expect(siblingNameTaken(tree, null, 'SS')).toBe(false)
    expect(siblingNameTaken(tree, null, 'ς')).toBe(false)
  })

  test('collapses only the middle breadcrumb segment', () => {
    const crumbs = ['root', 'a', 'b', 'c', 'leaf']
    expect(collapseBreadcrumbs(crumbs, 3)).toEqual({
      leading: ['root'],
      collapsed: ['a', 'b'],
      trailing: ['c', 'leaf'],
    })
    expect(collapseBreadcrumbs(crumbs, 5)).toEqual({
      leading: crumbs,
      collapsed: [],
      trailing: [],
    })
  })

  test('derives sorted project lists and direct counts from shared transcripts', () => {
    const transcripts = [
      transcript('older', 'project-a', '2026-09-01T00:00:00Z'),
      transcript('newer', 'project-a', '2026-09-03T00:00:00Z'),
      transcript('other', 'project-b', '2026-09-02T00:00:00Z'),
      transcript('unfiled', null, '2026-09-04T00:00:00Z'),
    ]

    expect(transcriptsInProject(transcripts, 'project-a').map((item) => item.id)).toEqual([
      'newer',
      'older',
    ])
    expect(transcriptsInProject(transcripts, null).map((item) => item.id)).toEqual(['unfiled'])
    expect(transcriptCountsByProject(transcripts)).toEqual(
      new Map([
        ['project-a', 2],
        ['project-b', 1],
      ])
    )
  })
})
