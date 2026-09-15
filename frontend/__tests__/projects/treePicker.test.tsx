import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectTreePicker } from '@/components/Projects/ProjectTreePicker'
import { buildProjectTree } from '@/core/projects/tree'
import { makeProject } from './fixtures'

describe('ProjectTreePicker', () => {
  const root = makeProject({ id: 'root', name: 'Root' })
  const child = makeProject({ id: 'child', name: 'Needle', parent_id: 'root' })
  const deleting = makeProject({ id: 'deleting', name: 'Deleting', deleting_at: '2026-09-15T00:00:00Z' })

  test('exposes tree semantics, excludes deleting nodes, and supports arrow/enter selection', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    render(<ProjectTreePicker tree={buildProjectTree([root, child, deleting])} value={null} onChange={onChange} />)

    expect(screen.getByRole('tree')).toHaveAttribute('aria-label', 'Project destinations')
    expect(screen.queryByRole('treeitem', { name: /Deleting/ })).not.toBeInTheDocument()
    const unfiled = screen.getByRole('treeitem', { name: 'Unfiled' })
    expect(unfiled).toHaveAttribute('aria-selected', 'true')
    unfiled.focus()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('child')
  })

  test('search reveals matches and their ancestors', async () => {
    const user = userEvent.setup()
    render(<ProjectTreePicker tree={buildProjectTree([root, child])} value={null} onChange={jest.fn()} />)
    await user.type(screen.getByLabelText('Search projects'), 'needle')
    expect(screen.getByRole('treeitem', { name: /Root/ })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /Needle/ })).toBeInTheDocument()
  })

  test('allows a selected project ancestor to be collapsed', async () => {
    const user = userEvent.setup()
    render(<ProjectTreePicker tree={buildProjectTree([root, child])} value="child" onChange={jest.fn()} />)

    const rootItem = screen.getByRole('treeitem', { name: /Root/ })
    expect(rootItem).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('treeitem', { name: /Needle/ })).toBeInTheDocument()

    rootItem.focus()
    await user.keyboard('{ArrowLeft}')

    expect(rootItem).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /Needle/ })).not.toBeInTheDocument()
  })

  test('keeps a rendered tree item tabbable when filtering removes the focus target', async () => {
    const user = userEvent.setup()
    render(<ProjectTreePicker tree={buildProjectTree([root, child])} value="child" onChange={jest.fn()} />)

    await user.type(screen.getByLabelText('Search projects'), 'no match')

    const treeItems = screen.getAllByRole('treeitem')
    expect(treeItems).toHaveLength(1)
    expect(treeItems[0]).toHaveAttribute('tabindex', '0')
    expect(treeItems[0]).toHaveTextContent('Unfiled')
  })
})
