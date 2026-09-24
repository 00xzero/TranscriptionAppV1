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

  test('shows the count only near the limit, and lets typing run past it without saving', async () => {
    const user = userEvent.setup()
    const onSubmit = jest.fn()
    render(<ProjectNameDialog open onOpenChange={jest.fn()} mode="create" parentId={null} onSubmit={onSubmit} />)
    const input = screen.getByLabelText('Project name')
    const counter = screen.getByTestId('character-count')
    expect(input).toHaveAccessibleDescription('Up to 80 characters.')

    await user.type(input, 'Dechra')
    expect(counter).toHaveClass('opacity-0')

    await user.clear(input)
    await user.type(input, 'x'.repeat(60))
    expect(counter).not.toHaveClass('opacity-0')
    expect(counter).toHaveTextContent('60/80')

    await user.type(input, 'x'.repeat(25))
    expect(input).toHaveValue('x'.repeat(85))
    expect(counter).toHaveTextContent(/^85\/80$/)

    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('alert')).toHaveTextContent('80 characters or fewer')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(input, '{Backspace}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-invalid')
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
