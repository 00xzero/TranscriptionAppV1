import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MoveTranscriptDialog } from '@/components/Projects/MoveTranscriptDialog'
import { buildProjectTree } from '@/core/projects/tree'
import { makeProject } from './fixtures'

const mockUseProjectsData = jest.fn()
jest.mock('@/lib/projects/ProjectsProvider', () => ({ useProjectsData: () => mockUseProjectsData() }))

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
      moveTranscript,
      createProject,
    })
  })

  test('preselects the current location, disables unchanged moves, and moves to Unfiled', async () => {
    const user = userEvent.setup()
    render(<MoveTranscriptDialog open onOpenChange={jest.fn()} transcript={{ id: 't1', title: 'Alpha', project_id: 'current' }} />)

    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    expect(screen.queryByRole('treeitem', { name: /Deleting/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('treeitem', { name: 'Unfiled' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(moveTranscript).toHaveBeenCalledWith('t1', null))
  })

  test('creates under the selected node and selects the new project', async () => {
    const user = userEvent.setup()
    render(<MoveTranscriptDialog open onOpenChange={jest.fn()} transcript={{ id: 't1', title: 'Alpha', project_id: 'current' }} />)
    await user.click(screen.getByRole('treeitem', { name: /Destination/ }))
    await user.click(screen.getByRole('button', { name: 'New Project' }))
    await user.type(await screen.findByLabelText('Project name'), 'Created')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ name: 'Created', parent_id: 'destination' }))
    expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled()
  })
})
