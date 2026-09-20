import {
  activeBranchIds,
  activeDescendantCount,
  ancestorsOf,
  branchIds,
  collapsedPathLabel,
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

describe('activeBranchIds', () => {
  const deleting = (p: Project): Project => ({ ...p, deleting_at: '2026-09-15T00:00:00Z' })

  test('walks the whole branch when nothing is being deleted', () => {
    const tree = buildProjectTree([
      project('root', 'Root'),
      project('child', 'Child', 'root'),
      project('grandchild', 'Grandchild', 'child'),
    ])

    expect(activeBranchIds(tree, 'root').sort()).toEqual(['child', 'grandchild', 'root'])
    expect(activeDescendantCount(tree, 'root')).toBe(2)
  })

  test('returns nothing when the root itself is being deleted', () => {
    const tree = buildProjectTree([
      deleting(project('root', 'Root')),
      project('child', 'Child', 'root'),
    ])

    expect(activeBranchIds(tree, 'root')).toEqual([])
    expect(activeDescendantCount(tree, 'root')).toBe(0)
  })

  test('prunes a deleting subtree rather than only its top node', () => {
    const tree = buildProjectTree([
      project('root', 'Root'),
      deleting(project('child', 'Child', 'root')),
      project('grandchild', 'Grandchild', 'child'),
      project('kept', 'Kept', 'root'),
    ])

    expect(activeBranchIds(tree, 'root').sort()).toEqual(['kept', 'root'])
    expect(activeDescendantCount(tree, 'root')).toBe(1)
  })

  test('treats a project whose parent is absent as its own branch root', () => {
    const tree = buildProjectTree([project('orphan', 'Orphan', 'missing-parent')])

    expect(tree.roots.map((item) => item.id)).toEqual(['orphan'])
    expect(activeBranchIds(tree, 'orphan')).toEqual(['orphan'])
  })

  test('returns nothing for an unknown id', () => {
    expect(activeBranchIds(buildProjectTree([]), 'nope')).toEqual([])
  })
})

describe('collapsedPathLabel', () => {
  const deepTree = buildProjectTree([
    project('a', 'Alpha'),
    project('b', 'Beta', 'a'),
    project('c', 'Gamma', 'b'),
    project('d', 'Delta', 'c'),
  ])

  test('a ground-level project is just its own name', () => {
    expect(collapsedPathLabel(deepTree, 'a')).toBe('Alpha')
  })

  test('one level of nesting shows both names', () => {
    expect(collapsedPathLabel(deepTree, 'b')).toBe('Alpha / Beta')
  })

  test('deeper nesting elides the middle', () => {
    expect(collapsedPathLabel(deepTree, 'c')).toBe('Alpha / … / Gamma')
    expect(collapsedPathLabel(deepTree, 'd')).toBe('Alpha / … / Delta')
  })

  test('an unknown id has no path', () => {
    expect(collapsedPathLabel(deepTree, 'missing')).toBe('')
  })
})
