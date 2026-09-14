'use client'

import { createContext, useContext, type ReactNode } from 'react'
import {
  useAuthIdentity,
  useProjectsRealtime,
  useTranscriptsRealtime,
} from '@/lib/supabase/hooks'

type ProjectsData = ReturnType<typeof useProjectsDataOwner>

const ProjectsDataContext = createContext<ProjectsData | null>(null)

function useProjectsDataOwner(userId: string | null, authPending: boolean) {
  const enabled = Boolean(userId)
  const projectData = useProjectsRealtime({ enabled, userId })
  const transcriptData = useTranscriptsRealtime({ enabled, userId })

  return {
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
  }
}

function ProjectsDataOwner({
  userId,
  authPending,
  children,
}: {
  userId: string | null
  authPending: boolean
  children: ReactNode
}) {
  const value = useProjectsDataOwner(userId, authPending)
  return <ProjectsDataContext.Provider value={value}>{children}</ProjectsDataContext.Provider>
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { userId, ready } = useAuthIdentity()
  return (
    <ProjectsDataOwner
      key={userId ?? 'signed-out'}
      userId={userId}
      authPending={!ready && !userId}
    >
      {children}
    </ProjectsDataOwner>
  )
}

export function useProjectsData(): ProjectsData {
  const value = useContext(ProjectsDataContext)
  if (!value) throw new Error('useProjectsData must be used within ProjectsProvider')
  return value
}
