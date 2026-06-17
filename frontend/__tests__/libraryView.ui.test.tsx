import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import LibraryView from '../components/LibraryView'
import type { Project } from '../contracts/db'
import { TooltipProvider } from '../components/ui/tooltip'

const mockGetUser = jest.fn()
const mockDeleteProject = jest.fn()
const mockUseProjectsRealtime = jest.fn()

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: '11111111-1111-1111-1111-111111111111',
  user_id: '22222222-2222-2222-2222-222222222222',
  title: 'Project Alpha',
  status: 'completed',
  source_object_key: null,
  upload_intent_id: null,
  duration_seconds: 245,
  waveform_object_key: null,
  waveform_status: 'skipped',
  waveform_points_per_second: null,
  waveform_version: null,
  created_at: '2026-04-01T12:00:00Z',
  updated_at: '2026-04-01T13:00:00Z',
  ...overrides,
})

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

jest.mock('@/lib/supabase/hooks', () => ({
  useProjectsRealtime: () => mockUseProjectsRealtime(),
}))

jest.mock('next/link', () => {
  function MockNextLink({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  }

  MockNextLink.displayName = 'MockNextLink'
  return MockNextLink
})

describe('LibraryView', () => {
  const renderLibraryView = () =>
    render(
      <TooltipProvider delayDuration={0}>
        <LibraryView />
      </TooltipProvider>
    )

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })
    mockDeleteProject.mockResolvedValue(undefined)
    mockUseProjectsRealtime.mockReturnValue({
      projects: [makeProject()],
      isLoading: false,
      deleteProject: mockDeleteProject,
    })
  })

  test('opens dropdown on trigger click and closes on Escape', async () => {
    const user = userEventLib.setup()
    renderLibraryView()

    await screen.findByText('Project Alpha')

    await user.click(screen.getByRole('button', { name: /More options for Project Alpha/i }))
    expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument()
    })
  })

  test('calls deleteProject and closes the menu when delete is confirmed', async () => {
    const user = userEventLib.setup()
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)

    renderLibraryView()
    await screen.findByText('Project Alpha')

    await user.click(screen.getByRole('button', { name: /More options for Project Alpha/i }))
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    await waitFor(() => {
      expect(mockDeleteProject).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111')
    })
    expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument()

    confirmSpy.mockRestore()
  })

  test('does not delete and closes the menu when delete is canceled', async () => {
    const user = userEventLib.setup()
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    renderLibraryView()
    await screen.findByText('Project Alpha')

    await user.click(screen.getByRole('button', { name: /More options for Project Alpha/i }))
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    expect(mockDeleteProject).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument()
    })

    confirmSpy.mockRestore()
  })
})
