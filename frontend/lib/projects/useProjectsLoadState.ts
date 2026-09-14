'use client'

import { useProjectsData } from '@/lib/projects/ProjectsProvider'

/** Combined load state for surfaces that need both the project and transcript lists. */
export function useProjectsLoadState() {
  const {
    projectsLoading,
    transcriptsLoading,
    projectError,
    transcriptError,
    refetchProjects,
    refetchTranscripts,
  } = useProjectsData()

  return {
    isLoading: projectsLoading || transcriptsLoading,
    loadError: projectError ?? transcriptError,
    retry: () => {
      void Promise.all([refetchProjects(), refetchTranscripts()])
    },
  }
}
