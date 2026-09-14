'use client'

import {
  createContext,
  memo,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import { buildProjectTree } from '@/core/projects/tree'
import {
  useAuthIdentity,
  useProjectsDeleteInvalidation,
  useProjectsRealtime,
  useTranscriptsRealtime,
} from '@/lib/supabase/hooks'

type ProjectsData = ReturnType<typeof useProjectsDataValue>

type PublishedData = {
  userId: string
  value: ProjectsData
}

const ProjectsDataContext = createContext<ProjectsData | null>(null)

function useProjectsDataValue(userId: string) {
  const projectData = useProjectsRealtime({ userId, enabled: true })
  const transcriptData = useTranscriptsRealtime({ userId, enabled: true })
  useProjectsDeleteInvalidation(
    userId,
    projectData.refetch,
    transcriptData.refetch
  )

  return {
    projects: projectData.projects,
    tree: projectData.tree,
    projectsLoading: projectData.isLoading,
    projectError: projectData.error,
    projectConnectionStatus: projectData.connectionStatus,
    createProject: projectData.createProject,
    renameProject: projectData.renameProject,
    mutateProjects: projectData.mutate,
    refetchProjects: projectData.refetch,
    transcripts: transcriptData.transcripts,
    transcriptsLoading: transcriptData.isLoading,
    transcriptError: transcriptData.error,
    transcriptConnectionStatus: transcriptData.connectionStatus,
    deleteTranscript: transcriptData.deleteTranscript,
    moveTranscript: transcriptData.moveTranscript,
    addTranscripts: transcriptData.addTranscripts,
    mutateTranscripts: transcriptData.mutate,
    refetchTranscripts: transcriptData.refetch,
  }
}

const rejectSignedOut = () => Promise.reject(new Error('You must be signed in.'))

function placeholderData(isLoading: boolean): ProjectsData {
  return {
    projects: [],
    tree: buildProjectTree([]),
    projectsLoading: isLoading,
    projectError: null,
    projectConnectionStatus: 'disconnected',
    createProject: rejectSignedOut,
    renameProject: rejectSignedOut,
    mutateProjects: () => undefined,
    refetchProjects: () => Promise.resolve(),
    transcripts: [],
    transcriptsLoading: isLoading,
    transcriptError: null,
    transcriptConnectionStatus: 'disconnected',
    deleteTranscript: rejectSignedOut,
    moveTranscript: rejectSignedOut,
    addTranscripts: rejectSignedOut,
    mutateTranscripts: () => undefined,
    refetchTranscripts: () => Promise.resolve(),
  }
}

const LOADING_DATA = placeholderData(true)
const SIGNED_OUT_DATA = placeholderData(false)

/**
 * Owns the table subscriptions for one user and publishes them to the provider.
 * It renders nothing and sits beside the app content rather than around it, so
 * keying it by user id discards the previous account's state without remounting
 * the app. `memo` is load-bearing: publishing sets provider state, and without it
 * the provider re-render would re-render this owner and publish again forever.
 */
const ProjectsDataOwner = memo(function ProjectsDataOwner({
  userId,
  onPublish,
}: {
  userId: string
  onPublish: (data: PublishedData | null) => void
}) {
  const value = useProjectsDataValue(userId)

  useLayoutEffect(() => {
    onPublish({ userId, value })
  }, [onPublish, userId, value])

  useLayoutEffect(() => () => onPublish(null), [onPublish])

  return null
})

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { userId, ready } = useAuthIdentity()
  const [published, setPublished] = useState<PublishedData | null>(null)

  let value: ProjectsData
  if (!userId) {
    value = ready ? SIGNED_OUT_DATA : LOADING_DATA
  } else {
    // Until this user's owner publishes, never expose another account's rows.
    value = published?.userId === userId ? published.value : LOADING_DATA
  }

  return (
    <>
      {userId ? (
        <ProjectsDataOwner key={userId} userId={userId} onPublish={setPublished} />
      ) : null}
      <ProjectsDataContext.Provider value={value}>{children}</ProjectsDataContext.Provider>
    </>
  )
}

export function useProjectsData(): ProjectsData {
  const value = useContext(ProjectsDataContext)
  if (!value) throw new Error('useProjectsData must be used within ProjectsProvider')
  return value
}
