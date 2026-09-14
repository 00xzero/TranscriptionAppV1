import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import ContextualHeader from '../components/ContextualHeader'
import { TooltipProvider } from '../components/ui/tooltip'
import { buildProjectTree } from '@/core/projects/tree'

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
    useProjectsDataMock.mockReturnValue({ tree: buildProjectTree([]) })
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
        {
          id: 'root',
          user_id: 'user-1',
          parent_id: null,
          name: 'Root',
          deleting_at: null,
          created_at: '2026-09-01T12:00:00Z',
          updated_at: '2026-09-01T12:00:00Z',
        },
        {
          id: 'child',
          user_id: 'user-1',
          parent_id: 'root',
          name: 'Child',
          deleting_at: null,
          created_at: '2026-09-01T12:00:00Z',
          updated_at: '2026-09-01T12:00:00Z',
        },
      ]),
    })

    renderHeader()

    expect(await screen.findByRole('link', { name: 'Child' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(screen.queryByText('Library')).not.toBeInTheDocument()
  })
})
