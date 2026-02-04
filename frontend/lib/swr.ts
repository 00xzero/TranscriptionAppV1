/**
 * @deprecated This file uses legacy FastAPI backend endpoints.
 * For new code, use the Supabase hooks in `lib/supabase/hooks.ts`:
 * - useProjectsRealtime() - replaces useProjects()
 * - useProjectRealtime() - replaces useProject()
 * - useChunksRealtime() - for editor chunk data
 * - useSpeakersRealtime() - for speaker management
 *
 * This file is kept for backwards compatibility with tests and
 * any remaining legacy code that hasn't been migrated yet.
 *
 * @see lib/supabase/hooks.ts for the new Supabase-based hooks
 */

/**
 * SWR configuration and custom hooks for API data fetching.
 * 
 * Provides:
 * - Authenticated fetcher with auth token
 * - Smart polling (only when processing)
 * - Automatic error handling
 * - Cache deduplication
 */
import useSWR, { SWRConfiguration } from 'swr'
import { getApiBase } from './api'

const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || 'devtoken'

/**
 * Authenticated fetcher for SWR.
 * Includes Authorization header and handles errors.
 */
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const error = new Error('API request failed') as Error & { status: number }
    error.status = res.status
    throw error
  }

  return res.json()
}

/**
 * Authenticated mutation helper for POST/PUT/DELETE requests.
 */
export async function mutationFetcher<T>(
  url: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(url, {
    method: options.method || 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Request failed (${res.status}): ${text}`)
  }

  // Handle empty responses (e.g., DELETE)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

// Type definitions
export type Project = {
  id: string
  title?: string
  status: string
  source_object_key: string
  duration_seconds?: number
  key_terms?: string[] | null
  created_at: string
  updated_at: string
}

export type Job = {
  id: string
  project_id: string
  celery_task_id?: string
  type: string
  status: string
  payload?: Record<string, unknown>
  created_at: string
  started_at?: string
  finished_at?: string
}

/**
 * Hook for fetching projects list with smart polling.
 * Only polls when there are projects in processing/queued state.
 */
export function useProjects(config?: SWRConfiguration) {
  const api = getApiBase()

  const { data, error, isLoading, mutate } = useSWR<Project[]>(
    `${api}/projects`,
    fetcher,
    {
      // Smart polling: refresh based on whether any project is processing
      refreshInterval: (latestData: Project[] | undefined) => {
        if (!latestData) return 0
        const hasActiveJobs = latestData.some((p: Project) =>
          ['queued', 'processing'].includes(p.status)
        )
        return hasActiveJobs ? 3000 : 0 // Poll every 3s if active, otherwise stop
      },
      revalidateOnFocus: true,
      dedupingInterval: 2000,
      ...config,
    }
  )

  return {
    projects: data || [],
    isLoading,
    isError: !!error,
    error,
    mutate,
  }
}

/**
 * Hook for fetching a single project.
 */
export function useProject(projectId: string | null, config?: SWRConfiguration) {
  const api = getApiBase()

  const { data, error, isLoading, mutate } = useSWR<Project>(
    projectId ? `${api}/projects/${projectId}` : null,
    fetcher,
    {
      revalidateOnFocus: true,
      ...config,
    }
  )

  return {
    project: data,
    isLoading,
    isError: !!error,
    error,
    mutate,
  }
}

/**
 * Hook for fetching jobs for a project.
 */
export function useProjectJobs(projectId: string | null, config?: SWRConfiguration) {
  const api = getApiBase()

  const { data, error, isLoading, mutate } = useSWR<Job[]>(
    projectId ? `${api}/projects/${projectId}/jobs` : null,
    fetcher,
    {
      refreshInterval: (latestData: Job[] | undefined) => {
        if (!latestData) return 0
        const hasActiveJobs = latestData.some((j: Job) =>
          ['queued', 'processing'].includes(j.status)
        )
        return hasActiveJobs ? 2000 : 0
      },
      ...config,
    }
  )

  return {
    jobs: data || [],
    isLoading,
    isError: !!error,
    error,
    mutate,
  }
}

/**
 * API actions with automatic cache revalidation.
 */
export function useProjectActions() {
  const api = getApiBase()

  const startProject = async (projectId: string) => {
    return mutationFetcher<{ project_id: string; task_id: string }>(
      `${api}/projects/${projectId}/start`,
      { method: 'POST' }
    )
  }

  const deleteProject = async (projectId: string) => {
    return mutationFetcher<void>(
      `${api}/projects/${projectId}`,
      { method: 'DELETE' }
    )
  }

  const getProjectJobs = async (projectId: string): Promise<Job[]> => {
    return fetcher<Job[]>(`${api}/projects/${projectId}/jobs`)
  }

  return {
    startProject,
    deleteProject,
    getProjectJobs,
  }
}
