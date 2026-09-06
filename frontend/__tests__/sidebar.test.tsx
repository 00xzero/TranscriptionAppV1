import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import Sidebar from '../components/Sidebar'
import { SIDEBAR_COLLAPSED_KEY } from '../lib/constants'

const usePathnameMock = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('../lib/recording/session', () => ({
  ...jest.requireActual('../lib/recording/session'),
  hasUnresolvedRecordingArtifact: () => false,
}))

jest.mock('../infra/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
      signOut: jest.fn(),
    },
  }),
}))

describe('Sidebar', () => {
  const user = userEventLib.setup()

  beforeEach(() => {
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
    const { container } = render(<Sidebar />)
    expect(container).toBeEmptyDOMElement()
  })
})
