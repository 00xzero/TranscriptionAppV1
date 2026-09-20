import type { Project, Transcript } from '@/contracts/db'

export type ProjectTree = {
  byId: Map<string, Project>
  childrenOf: Map<string, Project[]>
  roots: Project[]
}

export type CollapsedBreadcrumbs<T> = {
  leading: T[]
  collapsed: T[]
  trailing: T[]
}

const compareProjectNames = (a: Project, b: Project) => {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  return byName || a.id.localeCompare(b.id)
}

export function buildProjectTree(projects: Project[]): ProjectTree {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const childrenOf = new Map<string, Project[]>()
  const roots: Project[] = []

  for (const project of projects) {
    if (!project.parent_id || !byId.has(project.parent_id)) {
      roots.push(project)
      continue
    }

    const siblings = childrenOf.get(project.parent_id) ?? []
    siblings.push(project)
    childrenOf.set(project.parent_id, siblings)
  }

  roots.sort(compareProjectNames)
  for (const children of childrenOf.values()) children.sort(compareProjectNames)

  return { byId, childrenOf, roots }
}

export function ancestorsOf(tree: ProjectTree, id: string): Project[] | null {
  const project = tree.byId.get(id)
  if (!project) return null

  const ancestors: Project[] = []
  const visited = new Set([id])
  let parentId = project.parent_id

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = tree.byId.get(parentId)
    if (!parent) break
    ancestors.push(parent)
    parentId = parent.parent_id
  }

  return ancestors.reverse()
}

export function branchIds(tree: ProjectTree, id: string): string[] {
  if (!tree.byId.has(id)) return []

  const ids: string[] = []
  const pending = [id]
  const visited = new Set<string>()

  while (pending.length > 0) {
    const current = pending.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    ids.push(current)

    const children = tree.childrenOf.get(current) ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index].id)
    }
  }

  return ids
}

export function descendantCount(tree: ProjectTree, id: string): number {
  return Math.max(0, branchIds(tree, id).length - 1)
}

export function siblingNameTaken(
  tree: ProjectTree,
  parentId: string | null,
  name: string,
  excludeId?: string
): boolean {
  const normalizedName = name.trim().toLowerCase()
  const siblings = parentId === null ? tree.roots : tree.childrenOf.get(parentId) ?? []

  return siblings.some(
    (project) =>
      project.id !== excludeId && project.name.trim().toLowerCase() === normalizedName
  )
}

export function pathLabel(tree: ProjectTree, id: string): string {
  const project = tree.byId.get(id)
  if (!project) return ''
  return [...(ancestorsOf(tree, id) ?? []), project].map((item) => item.name).join(' / ')
}

export function collapseBreadcrumbs<T>(
  crumbs: T[],
  maxVisible: number
): CollapsedBreadcrumbs<T> {
  if (crumbs.length <= maxVisible) {
    return { leading: crumbs, collapsed: [], trailing: [] }
  }

  const trailingCount = Math.max(0, maxVisible - 1)
  return {
    leading: crumbs.slice(0, 1),
    collapsed: crumbs.slice(1, crumbs.length - trailingCount),
    trailing: trailingCount > 0 ? crumbs.slice(-trailingCount) : [],
  }
}

export function transcriptsInProject(
  transcripts: Transcript[],
  projectId: string | null
): Transcript[] {
  return transcripts
    .filter((transcript) => transcript.project_id === projectId)
    .sort((a, b) => {
      const byUpdatedAt = Date.parse(b.updated_at) - Date.parse(a.updated_at)
      return byUpdatedAt || a.id.localeCompare(b.id)
    })
}

export function transcriptCountsByProject(transcripts: Transcript[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const transcript of transcripts) {
    if (!transcript.project_id) continue
    counts.set(transcript.project_id, (counts.get(transcript.project_id) ?? 0) + 1)
  }
  return counts
}

export function activeBranchIds(tree: ProjectTree, id: string): string[] {
  const root = tree.byId.get(id)
  if (!root || root.deleting_at) return []

  const ids: string[] = []
  const pending = [id]
  const visited = new Set<string>()

  while (pending.length > 0) {
    const current = pending.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    ids.push(current)

    const children = tree.childrenOf.get(current) ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (child.deleting_at) continue
      pending.push(child.id)
    }
  }

  return ids
}

export function activeDescendantCount(tree: ProjectTree, id: string): number {
  return Math.max(0, activeBranchIds(tree, id).length - 1)
}

/**
 * A project's path with the middle elided: "Parent", "Parent / Child", or
 * "Parent / … / Leaf" once it runs deeper than `maxVisible`.
 */
export function collapsedPathLabel(
  tree: ProjectTree,
  id: string,
  maxVisible = 2
): string {
  const project = tree.byId.get(id)
  if (!project) return ''

  const names = [...(ancestorsOf(tree, id) ?? []), project].map((item) => item.name)
  const { leading, collapsed, trailing } = collapseBreadcrumbs(names, maxVisible)

  return [...leading, ...(collapsed.length > 0 ? ['…'] : []), ...trailing].join(' / ')
}
