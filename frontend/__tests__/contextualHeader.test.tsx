import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import ContextualHeader from '../components/ContextualHeader'
import { TooltipProvider } from '../components/ui/tooltip'
import { buildProjectTree } from '@/core/projects/tree'
import { makeProject } from './projects/fixtures'

const usePathnameMock = jest.fn()
const openCaptureModalMock = jest.fn()
const getUserMock = jest.fn()
const useProjectsDataMock = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('../lib/ModalContext', () => ({
  useModal: () => ({
    openCaptureModal: openCaptureModalMock,
  }),
}))

jest.mock('../infra/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      }),
    },
  }),
}))

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => useProjectsDataMock(),
}))

describe('ContextualHeader', () => {
  const renderHeader = () =>
    render(
      <TooltipProvider delayDuration={0}>
        <ContextualHeader />
      </TooltipProvider>
    )

  beforeEach(() => {
    jest.clearAllMocks()
    usePathnameMock.mockReturnValue('/editor/p1')
    getUserMock.mockResolvedValue({
      data: {
        user: { id: 'u1' },
      },
    })
    useProjectsDataMock.mockReturnValue({ tree: buildProjectTree([]), projectsLoading: false })
  })

  test('dispatches editor-scroll-to-top when the transcript breadcrumb is activated', async () => {
    const user = userEventLib.setup()
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent')

    renderHeader()

    const button = await waitFor(() =>
      screen.getByRole('button', { name: /scroll to the top of the transcript/i })
    )

    await user.click(button)

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'editor-scroll-to-top',
    }))
    expect(button).toHaveTextContent('Transcript')
  })

  test('hides Capture while the viewed project is marked for deletion', async () => {
    usePathnameMock.mockReturnValue('/projects/deleting')
    useProjectsDataMock.mockReturnValue({
      tree: buildProjectTree([
        makeProject({ id: 'deleting', deleting_at: '2026-09-15T00:00:00Z' }),
      ]),
      projectsLoading: false,
    })

    renderHeader()
    await waitFor(() => expect(screen.getByText('Project A')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Open capture modal' })).not.toBeInTheDocument()
  })

  test.each([
    ['project data is loading', true],
    ['the viewed project is absent', false],
  ])('hides Capture while %s', async (_description, projectsLoading) => {
    usePathnameMock.mockReturnValue('/projects/missing')
    useProjectsDataMock.mockReturnValue({ tree: buildProjectTree([]), projectsLoading })

    renderHeader()
    await screen.findByRole('textbox', { name: 'Recall a decision...' })
    expect(screen.queryByRole('button', { name: 'Open capture modal' })).not.toBeInTheDocument()
  })

  test('does not query Supabase auth on auth routes', async () => {
    usePathnameMock.mockReturnValue('/auth')

    renderHeader()

    expect(await screen.findByText('olivetti')).toBeInTheDocument()
    expect(getUserMock).not.toHaveBeenCalled()
  })

  test('renders project breadcrumbs instead of the Library title', async () => {
    usePathnameMock.mockReturnValue('/projects/child')
    useProjectsDataMock.mockReturnValue({
      tree: buildProjectTree([
        makeProject({ id: 'root', name: 'Root' }),
        makeProject({ id: 'child', name: 'Child', parent_id: 'root' }),
      ]),
      projectsLoading: false,
    })

    renderHeader()

    expect(await screen.findByRole('link', { name: 'Child' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(screen.queryByText('Library')).not.toBeInTheDocument()
  })

  test('opens Capture with the current project id on a project detail route', async () => {
    const user = userEventLib.setup()
    usePathnameMock.mockReturnValue('/projects/child')
    useProjectsDataMock.mockReturnValue({
      tree: buildProjectTree([makeProject({ id: 'child', name: 'Child' })]),
      projectsLoading: false,
    })

    renderHeader()
    await user.click(await screen.findByRole('button', { name: 'Open capture modal' }))

    expect(openCaptureModalMock).toHaveBeenCalledWith({ projectId: 'child' })
  })

  test('opens Capture without project intent outside a project detail route', async () => {
    const user = userEventLib.setup()
    usePathnameMock.mockReturnValue('/')

    renderHeader()
    await user.click(await screen.findByRole('button', { name: 'Open capture modal' }))

    expect(openCaptureModalMock).toHaveBeenCalledWith(undefined)
  })
})
