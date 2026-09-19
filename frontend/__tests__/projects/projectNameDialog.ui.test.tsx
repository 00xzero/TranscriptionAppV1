import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectNameDialog } from '@/components/Projects/ProjectNameDialog'
import { buildProjectTree } from '@/core/projects/tree'
import { makeProject } from './fixtures'
import { RealtimeScopeAbortError } from '@/lib/supabase/realtime'

const mockUseProjectsData = jest.fn()
jest.mock('@/lib/projects/ProjectsProvider', () => ({ useProjectsData: () => mockUseProjectsData() }))

describe('ProjectNameDialog', () => {
  beforeEach(() => {
    mockUseProjectsData.mockReturnValue({ tree: buildProjectTree([makeProject({ name: 'Existing' })]) })
  })

  test('uses shared validation and rejects a duplicate sibling before submitting', async () => {
    const user = userEvent.setup()
    const onSubmit = jest.fn()
    const view = render(<ProjectNameDialog open onOpenChange={jest.fn()} mode="create" parentId={null} onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a project name.')

    await user.type(screen.getByLabelText('Project name'), ' existing ')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('alert')).toHaveTextContent('already exists')
    expect(onSubmit).not.toHaveBeenCalled()
    view.unmount()
  })

  test('maps write errors inline and stays open', async () => {
    const user = userEvent.setup()
    const onOpenChange = jest.fn()
    const onSubmit = jest.fn().mockRejectedValue({ code: 'PJ002' })
    render(<ProjectNameDialog open onOpenChange={onOpenChange} mode="rename" parentId={null} projectId="project-a" initialName="Existing" onSubmit={onSubmit} />)

    const input = screen.getByLabelText('Project name')
    await user.clear(input)
    await user.type(input, 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('being deleted')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('closes quietly and resets local state on scope cancellation', async () => {
    const user = userEvent.setup()
    const onOpenChange = jest.fn()
    const onSubmit = jest.fn().mockRejectedValue(new RealtimeScopeAbortError())
    render(
      <ProjectNameDialog
        open
        onOpenChange={onOpenChange}
        mode="rename"
        parentId={null}
        projectId="project-a"
        initialName="Existing"
        onSubmit={onSubmit}
      />
    )

    const input = screen.getByLabelText('Project name')
    await user.clear(input)
    await user.type(input, 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(input).toHaveValue('Existing')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
