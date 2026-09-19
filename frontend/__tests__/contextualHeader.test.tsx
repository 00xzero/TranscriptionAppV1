import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import ContextualHeader from '../components/ContextualHeader'
import { TooltipProvider } from '../components/ui/tooltip'
import { buildProjectTree } from '@/core/projects/tree'
import {
  makeProject,
  makeTranscript,
  projectProviderData,
  transcriptProviderData,
} from './projects/fixtures'

const usePathnameMock = jest.fn()
const openCaptureModalMock = jest.fn()
const getUserMock = jest.fn()
const useProjectsDataMock = jest.fn()
const useTranscriptsDataMock = jest.fn()

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
  useTranscriptsData: () => useTranscriptsDataMock(),
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
    useProjectsDataMock.mockReturnValue(projectProviderData([]))
    useTranscriptsDataMock.mockReturnValue(transcriptProviderData([]))
  })

  test('dispatches editor-scroll-to-top when the transcript breadcrumb is activated', async () => {
    const user = userEventLib.setup()
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent')
    useTranscriptsDataMock.mockReturnValue({
      ...transcriptProviderData([]),
      transcriptsLoading: true,
    })

    renderHeader()

    const button = await waitFor(() =>
      screen.getByRole('button', { name: 'Transcript, scroll to top' })
    )

    await user.click(button)

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'editor-scroll-to-top',
    }))
    expect(button).toHaveTextContent('Transcript')
    expect(screen.getByRole('navigation', { name: 'Editor breadcrumbs' })).toBeInTheDocument()
    expect(screen.queryByText('Library')).not.toBeInTheDocument()
  })

  test('renders a filed transcript through its nested project hierarchy', async () => {
    const root = makeProject({ id: 'root', name: 'Root' })
    const child = makeProject({ id: 'child', name: 'Child', parent_id: root.id })
    useProjectsDataMock.mockReturnValue(projectProviderData([root, child]))
    useTranscriptsDataMock.mockReturnValue(transcriptProviderData([
      makeTranscript({ id: 'p1', title: 'Planning call', project_id: child.id }),
    ]))

    renderHeader()

    expect(await screen.findByRole('navigation', { name: 'Editor breadcrumbs' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(screen.getByRole('link', { name: 'Root' })).toHaveAttribute('href', '/projects/root')
    expect(screen.getByRole('link', { name: 'Child' })).toHaveAttribute('href', '/projects/child')
    expect(screen.getByRole('button', { name: 'Planning call, scroll to top' }))
      .toHaveTextContent('Planning call')
  })

  test('links an unfiled transcript to the Unfiled section', async () => {
    useTranscriptsDataMock.mockReturnValue(
      transcriptProviderData([makeTranscript({ id: 'p1', title: 'Loose note' })])
    )

    renderHeader()

    expect(await screen.findByRole('link', { name: 'Unfiled' })).toHaveAttribute(
      'href',
      '/projects#unfiled'
    )
    expect(screen.getByRole('button', { name: 'Loose note, scroll to top' }))
      .toHaveTextContent('Loose note')
  })

  test('uses the transcript fallback label for an untitled provider row', async () => {
    useTranscriptsDataMock.mockReturnValue(
      transcriptProviderData([makeTranscript({ id: 'p1', title: null })])
    )

    renderHeader()

    expect(await screen.findByRole('button', { name: 'Transcript, scroll to top' }))
      .toHaveTextContent('Transcript')
  })

  test('does not misclassify a transcript whose project is missing as Unfiled', async () => {
    useTranscriptsDataMock.mockReturnValue(transcriptProviderData([
      makeTranscript({ id: 'p1', title: 'Dangling note', project_id: 'missing-project' }),
    ]))

    renderHeader()

    expect(await screen.findByRole('button', { name: 'Dangling note, scroll to top' }))
      .toHaveTextContent('Dangling note')
    expect(screen.queryByRole('link', { name: 'Unfiled' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument()
  })

  test('keeps a deleting project in the truthful editor breadcrumb path', async () => {
    const deleting = makeProject({
      id: 'deleting',
      name: 'Deleting project',
      deleting_at: '2026-09-15T00:00:00Z',
    })
    useProjectsDataMock.mockReturnValue(projectProviderData([deleting]))
    useTranscriptsDataMock.mockReturnValue(transcriptProviderData([
      makeTranscript({ id: 'p1', project_id: deleting.id }),
    ]))

    renderHeader()

    expect(await screen.findByRole('link', { name: 'Deleting project' })).toHaveAttribute(
      'href',
      '/projects/deleting'
    )
  })

  test('updates the editor trail when provider project data changes', async () => {
    const projectA = makeProject({ id: 'project-a', name: 'Project A' })
    const projectB = makeProject({ id: 'project-b', name: 'Project B' })
    let projectData = projectProviderData([projectA, projectB])
    let transcriptData = transcriptProviderData([
      makeTranscript({ id: 'p1', title: 'Call', project_id: projectA.id }),
    ])
    useProjectsDataMock.mockImplementation(() => projectData)
    useTranscriptsDataMock.mockImplementation(() => transcriptData)
    const view = renderHeader()

    expect(await screen.findByRole('link', { name: 'Project A' })).toBeInTheDocument()

    projectData = projectProviderData([projectA, { ...projectB, name: 'Renamed B' }])
    transcriptData = transcriptProviderData([
      makeTranscript({ id: 'p1', title: 'Renamed call', project_id: projectB.id }),
    ])
    view.rerender(
      <TooltipProvider delayDuration={0}>
        <ContextualHeader />
      </TooltipProvider>
    )

    expect(screen.getByRole('link', { name: 'Renamed B' })).toHaveAttribute(
      'href',
      '/projects/project-b'
    )
    expect(screen.queryByRole('link', { name: 'Project A' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Renamed call, scroll to top' }))
      .toHaveTextContent('Renamed call')
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
    expect(screen.getByRole('navigation', { name: 'Project breadcrumbs' })).toBeInTheDocument()
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
