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
import { RemotePresenceProvider, type RemotePresenceStatus } from '@/lib/recording/RemotePresenceContext'
import { mockSignOut, resetTestAuth, setTestAuth, testUser } from '@/__tests__/helpers/auth'

const pushMock = jest.fn()
const refreshMock = jest.fn()
const toastMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  usePathname: () => '/transcripts',
}))

jest.mock('@/components/ui/toaster', () => ({
  toast: (opts: unknown) => toastMock(opts),
}))

jest.mock('@/lib/auth/AuthProvider', () => require('@/__tests__/helpers/auth').authProviderMock)

// Sign out now lives inside the account dropdown, so we render, confirm the
// provider user is shown (its email appears in the account trigger), open the
// menu, and activate the "Sign out" menu item.
async function renderAndClickSignOut(remote: RemotePresenceStatus = { kind: 'none' }) {
  const user = userEvent.setup()
  render(
    <RemotePresenceProvider value={remote}>
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    </RemotePresenceProvider>
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
    resetTestAuth()
    setTestAuth({
      userId: 'u1',
      ready: true,
      user: testUser({ email: 'a@b.com' }),
    })
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

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalledWith('/auth')
  })

  // The session is shared by every tab, so signing out here would stop another
  // tab's recording from uploading.
  test.each<RemotePresenceStatus>([
    { kind: 'active', sessionId: 's1', title: 'Board meeting', state: 'recording', startedAt: 1, lastResumeAt: null, pausedAccumulatedMs: 0 },
    { kind: 'active', sessionId: 's1', title: null, state: 'uploading', startedAt: 1, lastResumeAt: null, pausedAccumulatedMs: 0 },
    { kind: 'lock-only' },
  ])('blocks sign-out and toasts while another tab is recording ($kind)', async (remote) => {
    await renderAndClickSignOut(remote)

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Finish your recording first',
      description: expect.stringContaining('another tab'),
    }))
  })

  test('a recording left to recover in another tab does not block sign-out', async () => {
    await renderAndClickSignOut({ kind: 'owner-lost', sessionId: 's1' })

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1))
  })

  test('signs out normally when idle', async () => {
    await renderAndClickSignOut()

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1))
    expect(toastMock).not.toHaveBeenCalled()
  })
})
