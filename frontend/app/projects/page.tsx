"use client"
import Link from 'next/link'
import { useState, useCallback, useEffect } from 'react'
import { useProjects, useProjectActions, Project } from '../../lib/swr'
import { EditKeyTermsModal } from '../../components/EditKeyTermsModal'

type JobPayload = {
  error?: string
  error_type?: string
}

type Job = {
  id: string
  status: string
  payload?: JobPayload | null
}

export default function ProjectsPage() {
  const { projects, isLoading, mutate } = useProjects()
  const { startProject: startProjectAction, deleteProject: deleteProjectAction, getProjectJobs } = useProjectActions()
  const [starting, setStarting] = useState<Record<string, boolean>>({})
  const [projectErrors, setProjectErrors] = useState<Record<string, { error: string; error_type: string }>>({})

  // Modal state
  const [editingProject, setEditingProject] = useState<{ id: string; terms: string[] } | null>(null)

  // Fetch error info for projects in error state
  const fetchProjectError = useCallback(async (projectId: string) => {
    try {
      const jobs: Job[] = await getProjectJobs(projectId)
      const errorJob = jobs.find(j => j.status === 'error' && j.payload?.error)
      if (errorJob?.payload) {
        setProjectErrors(prev => ({
          ...prev,
          [projectId]: {
            error: errorJob.payload?.error || 'Unknown error',
            error_type: errorJob.payload?.error_type || 'transcription_error'
          }
        }))
      }
    } catch (e) {
      console.error('Failed to fetch project error:', e)
    }
  }, [getProjectJobs])

  // Fetch errors for projects in error state on initial load
  useEffect(() => {
    projects.forEach(p => {
      if (p.status === 'error' && !projectErrors[p.id]) {
        fetchProjectError(p.id)
      }
    })
  }, [projects, projectErrors, fetchProjectError])

  const startProject = async (id: string) => {
    if (starting[id]) return
    setStarting((prev) => ({ ...prev, [id]: true }))
    try {
      await startProjectAction(id)
      // Clear any previous error
      setProjectErrors(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      // Revalidate the projects list
      mutate()
    } catch (e) {
      console.error(e)
      alert(String(e))
      setStarting((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const deleteProject = async (id: string) => {
    const ok = window.confirm(
      'Disclaimer: Deleting a project will permanently remove the project and all associated data (segments, speakers, and jobs). This action cannot be undone. Do you want to proceed?'
    )
    if (!ok) return
    try {
      await deleteProjectAction(id)
      // Optimistically update cache and revalidate
      mutate(
        projects.filter(p => p.id !== id),
        { revalidate: true }
      )
    } catch (e) {
      console.error(e)
      alert(String(e))
    }
  }

  const handleOpenEditModal = (project: Project) => {
    setEditingProject({
      id: project.id,
      terms: project.key_terms || []
    })
  }

  const handleKeyTermsSaved = (newTerms: string[]) => {
    // Update local state and trigger project list refresh
    mutate()
    // Clear error since user fixed the terms
    if (editingProject) {
      setProjectErrors(prev => {
        const next = { ...prev }
        delete next[editingProject.id]
        return next
      })
    }
  }

  const getErrorInfo = (projectId: string) => projectErrors[projectId]

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Projects</h1>
      {isLoading && <div className="text-muted">Loading...</div>}
      {!isLoading && projects.length === 0 && <div className="text-muted">No projects yet.</div>}
      <ul className="space-y-2">
        {projects.map((p) => {
          const errorInfo = p.status === 'error' ? getErrorInfo(p.id) : null
          const isKeytermError = errorInfo?.error_type === 'keyterm_error'

          return (
            <li key={p.id} className="bg-surface border border-base rounded p-3">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{p.title || p.id}</div>
                  <div className="text-xs text-muted">{p.status} • {new Date(p.created_at).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-3">
                  {(() => {
                    const isCompleted = p.status === 'completed'
                    const isTranscribing = !!starting[p.id] || ['queued', 'processing'].includes(p.status)
                    const canTranscribe = !isCompleted && !isTranscribing && ['created', 'error'].includes(p.status)
                    const label = isCompleted ? 'Transcribed' : isTranscribing ? 'Transcribing...' : 'Transcribe'
                    const className = isCompleted
                      ? 'px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50'
                      : 'px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-50'
                    return (
                      <button
                        className={className}
                        onClick={() => startProject(p.id)}
                        disabled={!canTranscribe}
                        title="Transcribe audio"
                      >
                        {label}
                      </button>
                    )
                  })()}
                  <Link href={`/editor/${p.id}`} className="accent hover:underline">Open</Link>
                  <button
                    className="p-2 rounded bg-red-600 text-white hover:bg-red-700"
                    onClick={() => deleteProject(p.id)}
                    title="Delete project"
                    aria-label="Delete project"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M9 3.75A2.25 2.25 0 0 1 11.25 1.5h1.5A2.25 2.25 0 0 1 15 3.75V4.5h3.75a.75.75 0 0 1 0 1.5h-.6l-1.095 13.14A3 3 0 0 1 14.07 22.5H9.93a3 3 0 0 1-2.985-3.36L5.85 6H5.25a.75.75 0 0 1 0-1.5H9V3.75Zm1.5.75h3V3.75a.75.75 0 0 0-.75-.75h-1.5a.75.75 0 0 0-.75.75V4.5Zm-2.91 1.5h8.82l-1.08 12.96a1.5 1.5 0 0 1-1.485 1.29H9.93a1.5 1.5 0 0 1-1.485-1.29L7.59 6Z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Error display */}
              {errorInfo && (
                <div className="mt-3 p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <div className="flex items-start gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5">
                      <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm text-red-700 dark:text-red-300">{errorInfo.error}</p>
                      {isKeytermError && (
                        <button
                          onClick={() => handleOpenEditModal(p)}
                          className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Edit Key Terms
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Edit Key Terms Modal */}
      {editingProject && (
        <EditKeyTermsModal
          projectId={editingProject.id}
          currentTerms={editingProject.terms}
          isOpen={true}
          onClose={() => setEditingProject(null)}
          onSaved={handleKeyTermsSaved}
        />
      )}
    </div>
  )
}
