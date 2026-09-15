import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddTranscriptsDialog } from '@/components/Projects/AddTranscriptsDialog'
import { buildProjectTree } from '@/core/projects/tree'
import { makeProject, makeTranscript } from './fixtures'

const mockUseProjectsData = jest.fn()
jest.mock('@/lib/projects/ProjectsProvider', () => ({ useProjectsData: () => mockUseProjectsData() }))

describe('AddTranscriptsDialog', () => {
  test('excludes direct members, searches, shows paths, and batches selected ids', async () => {
    const user = userEvent.setup()
    const addTranscripts = jest.fn().mockResolvedValue({ addedIds: ['other'], missingIds: [] })
    const source = makeProject({ id: 'source', name: 'Source' })
    const deleting = makeProject({
      id: 'deleting',
      name: 'Deleting',
      deleting_at: '2026-09-15T00:00:00Z',
    })
    mockUseProjectsData.mockReturnValue({
      tree: buildProjectTree([source, deleting]),
      transcripts: [
        makeTranscript({ id: 'direct', title: 'Already here', project_id: 'target' }),
        makeTranscript({ id: 'other', title: 'Research call', project_id: 'source' }),
        makeTranscript({ id: 'unfiled', title: 'Another note' }),
        makeTranscript({ id: 'deleting-note', title: 'Deletion in progress', project_id: 'deleting' }),
      ],
      addTranscripts,
    })

    render(<AddTranscriptsDialog projectId="target" onClose={jest.fn()} />)
    expect(screen.queryByText('Already here')).not.toBeInTheDocument()
    expect(screen.queryByText('Deletion in progress')).not.toBeInTheDocument()
    expect(screen.getByText(/Source/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search transcripts'), 'research')
    expect(screen.queryByText('Another note')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(addTranscripts).toHaveBeenCalledWith(['other'], 'target'))
  })
})
