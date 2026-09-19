'use client'

import { DeleteProjectDialog } from '@/components/Projects/DeleteProjectDialog'
import { ProjectNameDialog } from '@/components/Projects/ProjectNameDialog'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import type { ProjectActions } from '@/lib/projects/useProjectActions'

/**
 * The one Create, Rename and Delete dialog a surface mounts for all of its project rows
 * and cards. Reading provider data here keeps the owning surface off the context
 * subscription, matching TranscriptActionDialogs.
 */
export function ProjectActionDialogs({ actions }: { actions: ProjectActions }) {
  const { createProject, renameProject } = useProjectsData()
  const { createTarget, renameTarget, deleteTarget } = actions

  return (
    <>
      {createTarget && (
        <ProjectNameDialog
          open
          onOpenChange={(open) => !open && actions.closeCreate()}
          mode="create"
          parentId={createTarget.parentId}
          onSubmit={(name) => createProject({ name, parent_id: createTarget.parentId })}
        />
      )}
      {renameTarget && (
        <ProjectNameDialog
          open
          onOpenChange={(open) => !open && actions.closeRename()}
          mode="rename"
          parentId={renameTarget.parent_id}
          projectId={renameTarget.id}
          initialName={renameTarget.name}
          onSubmit={(name) => renameProject(renameTarget.id, name)}
        />
      )}
      {deleteTarget && (
        <DeleteProjectDialog project={deleteTarget} onClose={actions.closeDelete} />
      )}
    </>
  )
}
