'use client'

import { useProjectsData, useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { isRealtimeScopeAbortError } from '@/lib/supabase/realtime'

/** Combined load state for surfaces that need both the project and transcript lists. */
export function useProjectsLoadState() {
  const {
    projectsLoading,
    projectError,
    refetchProjects,
  } = useProjectsData()
  const { transcriptsLoading, transcriptError, refetchTranscripts } = useTranscriptsData()

  return {
    isLoading: projectsLoading || transcriptsLoading,
    loadError: projectError ?? transcriptError,
    retry: () => {
      void Promise.all([refetchProjects(), refetchTranscripts()]).catch((error: unknown) => {
        if (isRealtimeScopeAbortError(error)) return
        console.error('[projects] Failed to retry project data loading:', error)
      })
    },
  }
}
