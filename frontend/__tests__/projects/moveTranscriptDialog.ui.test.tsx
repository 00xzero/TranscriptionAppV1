import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MoveTranscriptDialog } from '@/components/Projects/MoveTranscriptDialog'
import { buildProjectTree } from '@/core/projects/tree'
import { makeProject, makeTranscript } from './fixtures'
import { RealtimeScopeAbortError } from '@/lib/supabase/realtime'

const mockUseProjectsData = jest.fn()
const mockUseTranscriptsData = jest.fn()
jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
  useTranscriptsData: () => mockUseTranscriptsData(),
}))

describe('MoveTranscriptDialog', () => {
  const moveTranscript = jest.fn()
  const createProject = jest.fn()
  const current = makeProject({ id: 'current', name: 'Current' })
  const destination = makeProject({ id: 'destination', name: 'Destination' })
  const deleting = makeProject({ id: 'deleting', name: 'Deleting', deleting_at: '2026-09-15T00:00:00Z' })

  beforeEach(() => {
    jest.clearAllMocks()
    moveTranscript.mockResolvedValue(undefined)
    createProject.mockResolvedValue(makeProject({ id: 'created', name: 'Created' }))
    mockUseProjectsData.mockReturnValue({
      tree: buildProjectTree([current, destination, deleting]),
      createProject,
    })
    mockUseTranscriptsData.mockReturnValue({ transcripts: [], moveTranscript })
  })

  test('preselects the current location, disables unchanged moves, and moves to Unfiled', async () => {
    const user = userEvent.setup()
    render(<MoveTranscriptDialog onClose={jest.fn()} transcript={{ id: 't1', title: 'Alpha', project_id: 'current' }} />)

    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    expect(screen.queryByRole('treeitem', { name: /Deleting/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('treeitem', { name: 'Unfiled' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(moveTranscript).toHaveBeenCalledWith('t1', null))
  })

  test('creates under the selected node and selects the new project', async () => {
    const user = userEvent.setup()
    render(<MoveTranscriptDialog onClose={jest.fn()} transcript={{ id: 't1', title: 'Alpha', project_id: 'current' }} />)
    await user.click(screen.getByRole('treeitem', { name: /Destination/ }))
    await user.click(screen.getByRole('button', { name: 'New Project' }))
    await user.type(await screen.findByLabelText('Project name'), 'Created')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ name: 'Created', parent_id: 'destination' }))
    expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled()
  })

  test('follows a live move made elsewhere while the selection is untouched', () => {
    const data = mockUseTranscriptsData()
    const target = { id: 't1', title: 'Alpha', project_id: 'current' }
    mockUseTranscriptsData.mockReturnValue({ ...data, transcripts: [makeTranscript({ id: 't1', project_id: 'current' })] })
    const view = render(<MoveTranscriptDialog onClose={jest.fn()} transcript={target} />)
    expect(screen.getByRole('treeitem', { name: /Current/ })).toHaveAttribute('aria-selected', 'true')

    mockUseTranscriptsData.mockReturnValue({ ...data, transcripts: [makeTranscript({ id: 't1', project_id: 'destination' })] })
    view.rerender(<MoveTranscriptDialog onClose={jest.fn()} transcript={target} />)

    expect(screen.getByRole('treeitem', { name: /Destination/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
  })

  test('keeps a destination the user picked when the transcript moves elsewhere', async () => {
    const user = userEvent.setup()
    const data = mockUseTranscriptsData()
    const target = { id: 't1', title: 'Alpha', project_id: 'current' }
    mockUseTranscriptsData.mockReturnValue({ ...data, transcripts: [makeTranscript({ id: 't1', project_id: 'current' })] })
    const view = render(<MoveTranscriptDialog onClose={jest.fn()} transcript={target} />)
    await user.click(screen.getByRole('treeitem', { name: 'Unfiled' }))

    mockUseTranscriptsData.mockReturnValue({ ...data, transcripts: [makeTranscript({ id: 't1', project_id: 'destination' })] })
    view.rerender(<MoveTranscriptDialog onClose={jest.fn()} transcript={target} />)

    expect(screen.getByRole('treeitem', { name: 'Unfiled' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled()
  })

  test('closes quietly when a move is cancelled by a scope change', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    moveTranscript.mockRejectedValueOnce(new RealtimeScopeAbortError())
    render(<MoveTranscriptDialog onClose={onClose} transcript={{ id: 't1', title: 'Alpha', project_id: 'current' }} />)

    await user.click(screen.getByRole('treeitem', { name: /Destination/ }))
    await user.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('does not select a project whose creation was cancelled by a scope change', async () => {
    const user = userEvent.setup()
    createProject.mockRejectedValueOnce(new RealtimeScopeAbortError())
    render(<MoveTranscriptDialog onClose={jest.fn()} transcript={{ id: 't1', title: 'Alpha', project_id: 'current' }} />)

    await user.click(screen.getByRole('treeitem', { name: /Destination/ }))
    await user.click(screen.getByRole('button', { name: 'New Project' }))
    await user.type(await screen.findByLabelText('Project name'), 'Cancelled')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('treeitem', { name: /Destination/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled()
  })
})
