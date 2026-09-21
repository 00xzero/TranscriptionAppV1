'use client'

import { useMemo, useState } from 'react'
import type { Project } from '@/contracts/db'
import { ancestorsOf, type ProjectTree } from '@/core/projects/tree'

export type VisibleProjectNode = { project: Project; depth: number }

function revealedIds(tree: ProjectTree, id: string | null, includeSelf: boolean): string[] {
  if (!id || !tree.byId.has(id)) return []
  const ids = (ancestorsOf(tree, id) ?? []).map((project) => project.id)
  return includeSelf ? [...ids, id] : ids
}

/**
 * Expand/collapse and search state for rendering a project tree, excluding
 * projects that are being deleted. `revealId` is expanded into view once it
 * resolves in the tree; the user stays free to collapse it afterwards.
 */
export function useProjectTreeView(
  tree: ProjectTree,
  revealId: string | null,
  { expandRevealed = false }: { expandRevealed?: boolean } = {}
) {
  const [query, setQuery] = useState('')
  const revealKey = revealId && tree.byId.has(revealId) ? revealId : null
  const [expanded, setExpanded] = useState(
    () => new Set(revealedIds(tree, revealKey, expandRevealed))
  )
  const [lastRevealKey, setLastRevealKey] = useState(revealKey)

  if (lastRevealKey !== revealKey) {
    setLastRevealKey(revealKey)
    setExpanded(new Set([...expanded, ...revealedIds(tree, revealKey, expandRevealed)]))
  }

  const setNodeExpanded = (id: string, next: boolean | 'toggle') => {
    setExpanded((current) => {
      const updated = new Set(current)
      if (next === true || (next === 'toggle' && !current.has(id))) updated.add(id)
      else updated.delete(id)
      return updated
    })
  }

  const available = useMemo(
    () => new Set([...tree.byId.values()].filter((project) => !project.deleting_at).map((project) => project.id)),
    [tree]
  )
  const normalizedQuery = query.trim().toLowerCase()
  const searchVisible = useMemo(() => {
    if (!normalizedQuery) return null
    const ids = new Set<string>()
    for (const project of tree.byId.values()) {
      if (!available.has(project.id) || !project.name.toLowerCase().includes(normalizedQuery)) continue
      ids.add(project.id)
      for (const ancestor of ancestorsOf(tree, project.id) ?? []) {
        if (available.has(ancestor.id)) ids.add(ancestor.id)
      }
    }
    return ids
  }, [available, normalizedQuery, tree])
  const isSearching = searchVisible !== null
  const isVisible = (id: string) => available.has(id) && (!searchVisible || searchVisible.has(id))
  const visibleChildren = (id: string) =>
    (tree.childrenOf.get(id) ?? []).filter((child) => isVisible(child.id))
  const visibleRoots = tree.roots.filter((project) => isVisible(project.id))
  const isExpanded = (id: string) => isSearching || expanded.has(id)

  const nodes = useMemo(() => {
    const result: VisibleProjectNode[] = []
    const visit = (project: Project, depth: number) => {
      if (!available.has(project.id) || (searchVisible && !searchVisible.has(project.id))) return
      result.push({ project, depth })
      if (searchVisible || expanded.has(project.id)) {
        for (const child of tree.childrenOf.get(project.id) ?? []) visit(child, depth + 1)
      }
    }
    for (const root of tree.roots) visit(root, 0)
    return result
  }, [available, expanded, searchVisible, tree])

  return {
    query,
    setQuery,
    isSearching,
    nodes,
    visibleRoots,
    visibleChildren,
    isExpanded,
    /** Whether the user has expanded `id`, ignoring search. */
    isManuallyExpanded: (id: string) => expanded.has(id),
    setNodeExpanded,
    isAvailable: (id: string) => available.has(id),
  }
}
