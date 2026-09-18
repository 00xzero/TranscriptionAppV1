'use client'

import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { isRealtimeScopeAbortError } from '@/lib/supabase/realtime'

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
      void Promise.all([refetchProjects(), refetchTranscripts()]).catch((error: unknown) => {
        if (isRealtimeScopeAbortError(error)) return
        // Retry is shown for an initial load error, so another qualifying failure
        // is already exposed by the underlying hook's load-error state.
      })
    },
  }
}
