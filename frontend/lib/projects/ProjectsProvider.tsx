'use client'

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import {
  useAuthIdentity,
  useProjectsDeleteInvalidation,
  useProjectsRealtime,
  useTranscriptsRealtime,
} from '@/lib/supabase/hooks'

type ProjectsData = ReturnType<typeof useProjectsDataValue>

const ProjectsDataContext = createContext<ProjectsData | null>(null)

function useProjectsDataValue(userId: string | null, ready: boolean) {
  const enabled = Boolean(userId)
  const projectData = useProjectsRealtime({ userId, enabled })
  const transcriptData = useTranscriptsRealtime({ userId, enabled })
  useProjectsDeleteInvalidation(
    userId,
    projectData.refetch,
    transcriptData.refetch
  )
  const authPending = !ready && !userId

  return useMemo(() => ({
    projects: projectData.projects,
    tree: projectData.tree,
    projectsLoading: authPending || projectData.isLoading,
    projectError: projectData.error,
    projectConnectionStatus: projectData.connectionStatus,
    createProject: projectData.createProject,
    renameProject: projectData.renameProject,
    mutateProjects: projectData.mutate,
    refetchProjects: projectData.refetch,
    transcripts: transcriptData.transcripts,
    transcriptsLoading: authPending || transcriptData.isLoading,
    transcriptError: transcriptData.error,
    transcriptConnectionStatus: transcriptData.connectionStatus,
    deleteTranscript: transcriptData.deleteTranscript,
    moveTranscript: transcriptData.moveTranscript,
    addTranscripts: transcriptData.addTranscripts,
    mutateTranscripts: transcriptData.mutate,
    refetchTranscripts: transcriptData.refetch,
  }), [authPending, projectData, transcriptData])
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { userId, ready } = useAuthIdentity()
  const value = useProjectsDataValue(userId, ready)

  return (
    <ProjectsDataContext.Provider value={value}>{children}</ProjectsDataContext.Provider>
  )
}

export function useProjectsData(): ProjectsData {
  const value = useContext(ProjectsDataContext)
  if (!value) throw new Error('useProjectsData must be used within ProjectsProvider')
  return value
}
