'use client'

import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, Inbox } from 'lucide-react'
import type { Project } from '@/contracts/db'
import { ancestorsOf, type ProjectTree } from '@/core/projects/tree'
import { Input } from '@/components/ui/input'

type VisibleNode = { project: Project; depth: number }

function selectedAncestorIds(tree: ProjectTree, value: string | null): string[] {
  if (!value) return []
  return (ancestorsOf(tree, value) ?? []).map((project) => project.id)
}

export function ProjectTreePicker({
  tree,
  value,
  onChange,
}: {
  tree: ProjectTree
  value: string | null
  onChange: (projectId: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(() => new Set(selectedAncestorIds(tree, value)))
  const [revealedValue, setRevealedValue] = useState(value)
  const [focusId, setFocusId] = useState(value ?? 'unfiled')
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  // Reveal a newly selected project once, leaving the user free to collapse its ancestors afterwards.
  if (revealedValue !== value) {
    setRevealedValue(value)
    setExpanded(new Set([...expanded, ...selectedAncestorIds(tree, value)]))
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
  const availableChildren = (id: string) =>
    (tree.childrenOf.get(id) ?? []).filter((child) => available.has(child.id))
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
  const nodes = useMemo(() => {
    const result: VisibleNode[] = []
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

  const orderedIds = ['unfiled', ...nodes.map(({ project }) => project.id)]
  const tabStopId = orderedIds.includes(focusId) ? focusId : 'unfiled'
  const focusItem = (id: string) => {
    setFocusId(id)
    itemRefs.current.get(id)?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent, id: string) => {
    const index = orderedIds.indexOf(id)
    if (event.key === 'ArrowDown' && index < orderedIds.length - 1) {
      event.preventDefault()
      focusItem(orderedIds[index + 1])
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      focusItem(orderedIds[index - 1])
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChange(id === 'unfiled' ? null : id)
    } else if (id !== 'unfiled' && event.key === 'ArrowRight') {
      const children = availableChildren(id)
      if (children.length > 0) {
        event.preventDefault()
        if (!expanded.has(id)) setNodeExpanded(id, true)
        else focusItem(children[0].id)
      }
    } else if (id !== 'unfiled' && event.key === 'ArrowLeft') {
      event.preventDefault()
      if (expanded.has(id)) {
        setNodeExpanded(id, false)
      } else {
        const parentId = tree.byId.get(id)?.parent_id
        focusItem(parentId && available.has(parentId) ? parentId : 'unfiled')
      }
    }
  }

  const itemClass = (selected: boolean) =>
    `flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/50 ${selected ? 'bg-warm-highlight text-foreground dark:bg-night-border' : 'hover:bg-subtle text-foreground/75'}`

  return (
    <div className="space-y-3">
      <Input
        aria-label="Search projects"
        placeholder="Search projects…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div role="tree" aria-label="Project destinations" className="max-h-72 overflow-y-auto rounded-sm border border-border bg-field/30 p-1">
        <button
          ref={(node) => { if (node) itemRefs.current.set('unfiled', node) }}
          type="button"
          role="treeitem"
          aria-selected={value === null}
          tabIndex={tabStopId === 'unfiled' ? 0 : -1}
          className={itemClass(value === null)}
          onFocus={() => setFocusId('unfiled')}
          onClick={() => onChange(null)}
          onKeyDown={(event) => handleKeyDown(event, 'unfiled')}
        >
          <Inbox className="h-4 w-4" aria-hidden="true" />
          Unfiled
        </button>
        {nodes.map(({ project, depth }) => {
          const hasChildren = availableChildren(project.id).length > 0
          const isExpanded = Boolean(searchVisible) || expanded.has(project.id)
          return (
            <button
              key={project.id}
              ref={(node) => { if (node) itemRefs.current.set(project.id, node) }}
              type="button"
              role="treeitem"
              aria-expanded={hasChildren ? isExpanded : undefined}
              aria-selected={value === project.id}
              tabIndex={tabStopId === project.id ? 0 : -1}
              className={itemClass(value === project.id)}
              style={{ paddingLeft: `${12 + depth * 20}px` }}
              onFocus={() => setFocusId(project.id)}
              onClick={() => onChange(project.id)}
              onDoubleClick={() => hasChildren && setNodeExpanded(project.id, true)}
              onKeyDown={(event) => handleKeyDown(event, project.id)}
            >
              {hasChildren ? (
                <span
                  aria-hidden="true"
                  onClick={(event) => {
                    event.stopPropagation()
                    setNodeExpanded(project.id, 'toggle')
                  }}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              ) : <span className="w-4" />}
              <Folder className="h-4 w-4" aria-hidden="true" />
              <span className="truncate">{project.name}</span>
            </button>
          )
        })}
        {normalizedQuery && nodes.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-muted">No matching projects.</p>
        )}
      </div>
    </div>
  )
}
