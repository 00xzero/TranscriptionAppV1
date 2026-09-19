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
type TranscriptsData = ReturnType<typeof useTranscriptsDataValue>

const ProjectsDataContext = createContext<ProjectsData | null>(null)
const TranscriptsDataContext = createContext<TranscriptsData | null>(null)

function useProjectsDataValue(
  projectData: ReturnType<typeof useProjectsRealtime>,
  authPending: boolean
) {
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
  }), [authPending, projectData])
}

function useTranscriptsDataValue(
  transcriptData: ReturnType<typeof useTranscriptsRealtime>,
  authPending: boolean
) {
  return useMemo(() => ({
    transcripts: transcriptData.transcripts,
    transcriptsLoading: authPending || transcriptData.isLoading,
    transcriptError: transcriptData.error,
    transcriptConnectionStatus: transcriptData.connectionStatus,
    deleteTranscript: transcriptData.deleteTranscript,
    moveTranscript: transcriptData.moveTranscript,
    addTranscripts: transcriptData.addTranscripts,
    mutateTranscripts: transcriptData.mutate,
    refetchTranscripts: transcriptData.refetch,
  }), [authPending, transcriptData])
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { userId, ready } = useAuthIdentity()
  const enabled = Boolean(userId)
  const projectData = useProjectsRealtime({ userId, enabled })
  const transcriptData = useTranscriptsRealtime({ userId, enabled })
  useProjectsDeleteInvalidation(userId, projectData.refetch, transcriptData.refetch)
  const authPending = !ready && !userId
  const projectsValue = useProjectsDataValue(projectData, authPending)
  const transcriptsValue = useTranscriptsDataValue(transcriptData, authPending)

  return (
    <ProjectsDataContext.Provider value={projectsValue}>
      <TranscriptsDataContext.Provider value={transcriptsValue}>
        {children}
      </TranscriptsDataContext.Provider>
    </ProjectsDataContext.Provider>
  )
}

export function useProjectsData(): ProjectsData {
  const value = useContext(ProjectsDataContext)
  if (!value) throw new Error('useProjectsData must be used within ProjectsProvider')
  return value
}

export function useTranscriptsData(): TranscriptsData {
  const value = useContext(TranscriptsDataContext)
  if (!value) throw new Error('useTranscriptsData must be used within ProjectsProvider')
  return value
}
