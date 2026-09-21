import { useState } from 'react'
import type { Project } from '@/contracts/db'

/** Where a pending create will put the new project. `null` parentId means ground level. */
export type ProjectCreateTarget = { parentId: string | null }

/** Which project, if any, a surface's single Create, Rename or Delete dialog is open for. */
export function useProjectActions() {
  const [createTarget, setCreateTarget] = useState<ProjectCreateTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<Project | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)

  return {
    createTarget,
    renameTarget,
    deleteTarget,
    openCreate: (parentId: string | null) => setCreateTarget({ parentId }),
    openRename: setRenameTarget,
    openDelete: setDeleteTarget,
    closeCreate: () => setCreateTarget(null),
    closeRename: () => setRenameTarget(null),
    closeDelete: () => setDeleteTarget(null),
  }
}

export type ProjectActions = ReturnType<typeof useProjectActions>
