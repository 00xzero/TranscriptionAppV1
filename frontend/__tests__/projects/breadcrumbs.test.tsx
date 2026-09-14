import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import type { Project } from '@/contracts/db'
import { Breadcrumbs } from '@/components/Projects/Breadcrumbs'
import { TooltipProvider } from '@/components/ui/tooltip'

let narrow = false

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      matches: narrow,
      media: '(max-width: 767px)',
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
})

const makeProject = (id: string, name: string, parentId: string | null): Project => ({
  id,
  user_id: 'user-1',
  parent_id: parentId,
  name,
  deleting_at: null,
  created_at: '2026-09-01T12:00:00Z',
  updated_at: '2026-09-01T12:00:00Z',
})

const projects = [
  makeProject('one', 'One', null),
  makeProject('two', 'Two', 'one'),
  makeProject('three', 'Three', 'two'),
  makeProject('four', 'Four', 'three'),
  makeProject('five', 'Five', 'four'),
  makeProject('six', 'Six', 'five'),
]

const renderBreadcrumbs = () =>
  render(
    <TooltipProvider delayDuration={0}>
      <Breadcrumbs ancestors={projects.slice(0, -1)} current={projects.at(-1)!} />
    </TooltipProvider>
  )

describe('Breadcrumbs', () => {
  beforeEach(() => {
    narrow = false
  })

  test('shows five crumbs on desktop and exposes collapsed ancestors as links', async () => {
    const user = userEventLib.setup()
    renderBreadcrumbs()

    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(screen.getByRole('link', { name: 'Six' })).toHaveAttribute(
      'href',
      '/projects/six'
    )
    expect(screen.getByRole('link', { name: 'Six' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('link', { name: 'One' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show hidden breadcrumbs' }))

    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveAttribute(
      'href',
      '/projects/one'
    )
    expect(screen.getByRole('menuitem', { name: 'Two' })).toHaveAttribute(
      'href',
      '/projects/two'
    )
  })

  test('shows the root and final two crumbs below the md breakpoint', async () => {
    narrow = true
    renderBreadcrumbs()

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Three' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Five' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Six' })).toHaveAttribute('aria-current', 'page')
  })
})
