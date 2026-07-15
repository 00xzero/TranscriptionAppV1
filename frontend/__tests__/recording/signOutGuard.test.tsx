import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import Sidebar from '@/components/Sidebar'
import {
  __resetForTesting,
  forceState,
  hasUnresolvedRecordingArtifact,
  startMock,
} from '@/lib/recording/session'

const pushMock = jest.fn()
const refreshMock = jest.fn()
const signOutMock = jest.fn().mockResolvedValue(undefined)
const toastMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  usePathname: () => '/transcripts',
}))

jest.mock('@/components/ui/toaster', () => ({
  toast: (opts: unknown) => toastMock(opts),
}))

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'u1', email: 'a@b.com', user_metadata: {} } },
      }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
      signOut: signOutMock,
    },
  }),
}))

// Sign out now lives inside the account dropdown, so we render, wait for the
// async user fetch to resolve (its email appears in the account trigger), open
// the menu, and activate the "Sign out" menu item.
async function renderAndClickSignOut() {
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>
  )
  await screen.findByText('a@b.com')
  await user.click(screen.getByRole('button', { name: /account menu/i }))
  await user.click(await screen.findByRole('menuitem', { name: /sign out/i }))
}

describe('sign-out auth-boundary guard', () => {
  beforeEach(() => {
    __resetForTesting()
    pushMock.mockReset()
    refreshMock.mockReset()
    signOutMock.mockClear()
    toastMock.mockReset()
  })

  test('predicate flags active, retryable, and recoverable artifacts', () => {
    expect(hasUnresolvedRecordingArtifact()).toBe(false)
    startMock()
    expect(hasUnresolvedRecordingArtifact()).toBe(true)
    forceState('recoverable')
    expect(hasUnresolvedRecordingArtifact()).toBe(true)
  })

  test('exposes coming-soon navigation as focusable aria-disabled buttons', async () => {
    render(
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    )
    await screen.findByText('a@b.com')

    for (const name of ['Drafts (coming soon)', 'Shared (coming soon)']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).not.toBeDisabled()
    }
  })

  test('blocks sign-out and toasts while recording', async () => {
    startMock()
    await renderAndClickSignOut()

    expect(signOutMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalledWith('/auth')
  })

  test('signs out normally when idle', async () => {
    await renderAndClickSignOut()

    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1))
    expect(toastMock).not.toHaveBeenCalled()
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/auth'))
  })
})
