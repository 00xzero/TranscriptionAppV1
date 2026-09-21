import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import Sidebar from '../components/Sidebar'
import { SIDEBAR_COLLAPSED_KEY } from '../lib/constants'

import {
  mockSignOut,
  resetTestAuth,
  setTestAuth,
  testUser,
} from '@/__tests__/helpers/auth'

const usePathnameMock = jest.fn()
const routerPushMock = jest.fn()
const toastMock = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ push: routerPushMock, replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('../lib/recording/session', () => ({
  ...jest.requireActual('../lib/recording/session'),
  hasUnresolvedRecordingArtifact: () => false,
}))

jest.mock('@/components/ui/toaster', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}))

jest.mock('@/lib/auth/AuthProvider', () => require('@/__tests__/helpers/auth').authProviderMock)

describe('Sidebar', () => {
  const user = userEventLib.setup()

  beforeEach(() => {
    jest.clearAllMocks()
    resetTestAuth()
    setTestAuth({ userId: null, ready: true })
    usePathnameMock.mockReturnValue('/')
    localStorage.clear()
  })

  const renderSidebar = async () => {
    const utils = render(<Sidebar />)
    // Wait past the hydration shell, which renders aria-hidden.
    await screen.findByRole('navigation')
    return utils
  }

  it('starts expanded when no preference is stored', async () => {
    await renderSidebar()
    expect(screen.getByRole('navigation')).toHaveAttribute('data-state', 'expanded')
  })

  it('initializes collapsed from a persisted preference', async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true')
    await renderSidebar()
    expect(screen.getByRole('navigation')).toHaveAttribute('data-state', 'collapsed')
    expect(screen.getByLabelText('Expand Sidebar')).toBeInTheDocument()
  })

  it('collapsing persists the preference', async () => {
    await renderSidebar()
    await user.click(screen.getByLabelText('Collapse Sidebar'))

    await waitFor(() => {
      expect(screen.getByRole('navigation')).toHaveAttribute('data-state', 'collapsed')
    })
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true')
    expect(screen.getByLabelText('Expand Sidebar')).toBeInTheDocument()
  })

  it('expanding restores the preference', async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true')
    await renderSidebar()
    await user.click(screen.getByLabelText('Expand Sidebar'))

    await waitFor(() => {
      expect(screen.getByRole('navigation')).toHaveAttribute('data-state', 'expanded')
    })
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false')
    expect(screen.getByLabelText('Collapse Sidebar')).toBeInTheDocument()
  })

  it('renders nothing on auth routes, so the content pane keeps the full width', () => {
    usePathnameMock.mockReturnValue('/auth')
    setTestAuth({ userId: 'user-a', ready: true, user: testUser('user-a', { email: 'ada@example.com' }) })
    const { container } = render(<Sidebar />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders Projects between Library and Drafts and marks project routes active', async () => {
    usePathnameMock.mockReturnValue('/projects/project-a')
    await renderSidebar()

    const library = screen.getByRole('button', { name: 'Library' })
    const projects = screen.getByRole('button', { name: 'Projects' })
    const drafts = screen.getByRole('button', { name: 'Drafts (coming soon)' })
    expect(library.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(projects.compareDocumentPosition(drafts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(projects).toHaveClass('border')
    expect(library).not.toHaveClass('border')
  })

  it('shows the provider user in the account menu', async () => {
    setTestAuth({
      userId: 'user-a',
      ready: true,
      user: testUser('user-a', { email: 'ada@example.com', user_metadata: { full_name: 'Ada Lovelace' } }),
    })
    await renderSidebar()

    const trigger = screen.getByRole('button', { name: 'Account menu' })
    expect(within(trigger).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(trigger).getByText('AL')).toBeInTheDocument()
  })

  it('keeps the account menu usable when identity is cached but unverified', async () => {
    setTestAuth({ userId: 'user-a', ready: false, user: null })
    await renderSidebar()

    const trigger = screen.getByRole('button', { name: 'Account menu' })
    expect(within(trigger).getByText('Account')).toBeInTheDocument()

    await user.click(trigger)
    expect(await screen.findByText('Sign out')).toBeInTheDocument()
  })

  // The recording guard and the happy-path sign-out are covered in
  // __tests__/recording/signOutGuard.test.tsx.
  it('stays on the page and reports the failure when provider sign-out rejects', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSignOut.mockRejectedValueOnce(new Error('session load failed'))
    setTestAuth({ userId: 'user-a', ready: true, user: testUser('user-a') })
    await renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(await screen.findByText('Sign out'))

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not sign out', variant: 'error' })
      )
    })
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(routerPushMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
