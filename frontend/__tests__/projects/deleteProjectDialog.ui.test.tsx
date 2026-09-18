import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeleteProjectDialog } from '@/components/Projects/DeleteProjectDialog'
import { buildProjectTree } from '@/core/projects/tree'
import { DeleteProjectRequestError } from '@/lib/projects/delete-client'
import { makeProject, makeTranscript } from './fixtures'

const mockDeleteProjectRequest = jest.fn()
const mockFetchCount = jest.fn()
const mockUseProjectsData = jest.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

jest.mock('@/lib/projects/delete-client', () => ({
  ...jest.requireActual('@/lib/projects/delete-client'),
  deleteProjectRequest: (...args: unknown[]) => mockDeleteProjectRequest(...args),
}))
jest.mock('@/lib/supabase/queries', () => ({
  fetchProjectBranchTranscriptCount: (...args: unknown[]) => mockFetchCount(...args),
}))
jest.mock('@/lib/projects/ProjectsProvider', () => ({ useProjectsData: () => mockUseProjectsData() }))

describe('DeleteProjectDialog', () => {
  const parent = makeProject({ id: 'parent', name: 'Parent' })
  const current = makeProject({ id: 'current', name: 'Current', parent_id: 'parent' })
  const child = makeProject({ id: 'child', name: 'Child', parent_id: 'current' })
  const mutateProjects = jest.fn()
  const mutateTranscripts = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchCount.mockResolvedValue(2)
    mockDeleteProjectRequest.mockResolvedValue({ deleted_projects: 2, deleted_transcripts: 2 })
    mockUseProjectsData.mockReturnValue({
      tree: buildProjectTree([parent, current, child]),
      mutateProjects,
      mutateTranscripts,
      transcripts: [makeTranscript({ project_id: 'current' })],
    })
  })

  test('shows branch counts and removes the completed branch from provider state', async () => {
    const user = userEvent.setup()
    render(<DeleteProjectDialog project={current} onClose={jest.fn()} />)
    expect(await screen.findByText(/1 nested project and 2 transcripts/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete Project' }))

    await waitFor(() => expect(mockDeleteProjectRequest).toHaveBeenCalledWith('current'))
    expect(mutateProjects).toHaveBeenCalledTimes(1)
    expect(mutateTranscripts).toHaveBeenCalledTimes(1)
  })

  test('keeps failures open with stage-specific details and changes the action to Retry', async () => {
    const user = userEvent.setup()
    mockDeleteProjectRequest.mockRejectedValueOnce(new DeleteProjectRequestError(502, {
      stage: 'storage',
      error: 'Storage cleanup failed.',
      removed_media: 1,
      removed_waveforms: 2,
      remaining_transcripts: 3,
    }))
    render(<DeleteProjectDialog project={current} onClose={jest.fn()} />)
    await screen.findByText(/2 transcripts/)
    await user.click(screen.getByRole('button', { name: 'Delete Project' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('1 media file')
    expect(screen.getByRole('alert')).toHaveTextContent('2 waveform files')
    expect(screen.getByRole('button', { name: 'Retry Delete' })).toBeEnabled()
    expect(mutateProjects).not.toHaveBeenCalled()
  })

  test('treats gone as success even on the first attempt', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    mockDeleteProjectRequest.mockRejectedValueOnce(
      new DeleteProjectRequestError(404, { stage: 'begin', error: 'Gone', gone: true })
    )
    render(<DeleteProjectDialog project={current} onClose={onClose} />)
    await screen.findByText(/2 transcripts/)
    await user.click(screen.getByRole('button', { name: 'Delete Project' }))
    await waitFor(() => expect(mutateProjects).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
  })

  test('finishes an account-switched delete without mutating the new scope', async () => {
    const user = userEvent.setup()
    const request = deferred<{ deleted_projects: number; deleted_transcripts: number }>()
    const nextMutateProjects = jest.fn()
    const nextMutateTranscripts = jest.fn()
    const onClose = jest.fn()
    mockDeleteProjectRequest.mockReturnValueOnce(request.promise)
    const view = render(<DeleteProjectDialog project={current} onClose={onClose} />)
    await screen.findByText(/2 transcripts/)
    await user.click(screen.getByRole('button', { name: 'Delete Project' }))
    await waitFor(() => expect(mockDeleteProjectRequest).toHaveBeenCalledWith('current'))

    mockUseProjectsData.mockReturnValue({
      tree: buildProjectTree([]),
      mutateProjects: nextMutateProjects,
      mutateTranscripts: nextMutateTranscripts,
      transcripts: [],
    })
    view.rerender(<DeleteProjectDialog project={current} onClose={onClose} />)

    await act(async () => {
      request.resolve({ deleted_projects: 2, deleted_transcripts: 2 })
      await request.promise
    })

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(nextMutateProjects).not.toHaveBeenCalled()
    expect(nextMutateTranscripts).not.toHaveBeenCalled()
  })
})
