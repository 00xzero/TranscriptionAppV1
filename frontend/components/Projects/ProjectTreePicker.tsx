'use client'

import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, Inbox } from 'lucide-react'
import type { ProjectTree } from '@/core/projects/tree'
import { Input } from '@/components/ui/input'
import { useProjectTreeView } from '@/lib/projects/useProjectTreeView'

export function ProjectTreePicker({
  tree,
  value,
  onChange,
}: {
  tree: ProjectTree
  value: string | null
  onChange: (projectId: string | null) => void
}) {
  const {
    query,
    setQuery,
    isSearching,
    nodes,
    visibleRoots,
    visibleChildren,
    isExpanded,
    isManuallyExpanded,
    setNodeExpanded,
    isAvailable,
  } = useProjectTreeView(tree, value)
  const [focusId, setFocusId] = useState(value ?? 'unfiled')
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

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
      const children = visibleChildren(id)
      if (children.length > 0) {
        event.preventDefault()
        if (!isExpanded(id)) setNodeExpanded(id, true)
        else focusItem(children[0].id)
      }
    } else if (id !== 'unfiled' && event.key === 'ArrowLeft') {
      event.preventDefault()
      if (!isSearching && isManuallyExpanded(id)) {
        setNodeExpanded(id, false)
      } else {
        const parentId = tree.byId.get(id)?.parent_id
        focusItem(parentId && isAvailable(parentId) ? parentId : 'unfiled')
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
          aria-level={1}
          aria-posinset={1}
          aria-setsize={visibleRoots.length + 1}
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
          const children = visibleChildren(project.id)
          const hasChildren = children.length > 0
          const expanded = isExpanded(project.id)
          const siblings = project.parent_id ? visibleChildren(project.parent_id) : visibleRoots
          const position = siblings.findIndex((sibling) => sibling.id === project.id) + 1
          return (
            <button
              key={project.id}
              ref={(node) => { if (node) itemRefs.current.set(project.id, node) }}
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              aria-posinset={project.parent_id ? position : position + 1}
              aria-setsize={project.parent_id ? siblings.length : siblings.length + 1}
              aria-expanded={hasChildren ? expanded : undefined}
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
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              ) : <span className="w-4" />}
              <Folder className="h-4 w-4" aria-hidden="true" />
              <span className="truncate">{project.name}</span>
            </button>
          )
        })}
        {isSearching && nodes.length === 0 && (
          <p role="status" className="px-3 py-4 text-center text-sm text-muted">
            No matching projects.
          </p>
        )}
      </div>
    </div>
  )
}
