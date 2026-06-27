import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  usePathname: () => '/projects',
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

async function renderSidebarWithUser() {
  render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>
  )
  // The user is loaded asynchronously; the Sign out button appears once it is.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  )
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

  test('blocks sign-out and toasts while recording', async () => {
    startMock()
    await renderSidebarWithUser()

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    expect(signOutMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalledWith('/auth')
  })

  test('signs out normally when idle', async () => {
    await renderSidebarWithUser()

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1))
    expect(toastMock).not.toHaveBeenCalled()
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/auth'))
  })
})
