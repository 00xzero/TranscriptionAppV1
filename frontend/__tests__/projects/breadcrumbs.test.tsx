import React from 'react'
import { render, screen } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import {
  Breadcrumbs,
  BreadcrumbTrail,
  type BreadcrumbTrailItem,
} from '@/components/Projects/Breadcrumbs'
import { makeProject } from './fixtures'

let narrow = false

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      matches: narrow,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  })
})

const projects = [
  makeProject({ id: 'one', name: 'One' }),
  makeProject({ id: 'two', name: 'Two', parent_id: 'one' }),
  makeProject({ id: 'three', name: 'Three', parent_id: 'two' }),
  makeProject({ id: 'four', name: 'Four', parent_id: 'three' }),
  makeProject({ id: 'five', name: 'Five', parent_id: 'four' }),
  makeProject({ id: 'six', name: 'Six', parent_id: 'five' }),
]

const renderBreadcrumbs = () =>
  render(<Breadcrumbs ancestors={projects.slice(0, -1)} current={projects.at(-1)!} />)

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

  test('shows the root and final two crumbs below the md breakpoint', () => {
    narrow = true
    renderBreadcrumbs()

    expect(screen.queryByRole('link', { name: 'Three' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Five' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Six' })).toHaveAttribute('aria-current', 'page')
  })

  test('renders a collapsed editor trail with its own label and current action', async () => {
    const user = userEventLib.setup()
    const onActivate = jest.fn()
    narrow = true
    const items: BreadcrumbTrailItem[] = [
      { id: 'root', label: 'Projects', href: '/projects' },
      { id: 'one', label: 'One', href: '/projects/one' },
      { id: 'two', label: 'Two', href: '/projects/two' },
      { id: 'three', label: 'Three', href: '/projects/three' },
      { id: 'four', label: 'Four', href: '/projects/four' },
      {
        id: 'transcript',
        label: 'Call notes',
        onActivate,
        ariaLabel: 'Call notes, scroll to top',
      },
    ]

    render(
      <BreadcrumbTrail
        items={items}
        currentId="transcript"
        ariaLabel="Editor breadcrumbs"
      />
    )

    expect(screen.getByRole('navigation', { name: 'Editor breadcrumbs' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'One' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Three' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Four' })).toBeInTheDocument()
    const current = screen.getByRole('button', { name: 'Call notes, scroll to top' })
    expect(current).toHaveAttribute('aria-current', 'page')
    await user.click(current)
    expect(onActivate).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Show hidden breadcrumbs' }))
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveAttribute('href', '/projects/one')
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveAttribute('href', '/projects/three')
  })
})
