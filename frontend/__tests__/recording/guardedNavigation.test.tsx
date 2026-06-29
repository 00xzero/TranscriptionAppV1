import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  GuardedLink,
  useGuardedNavigate,
} from '@/lib/recording/guardedNavigation'
import {
  __resetForTesting,
  forceState,
  getSnapshot,
  startMock,
} from '@/lib/recording/session'

const pushMock = jest.fn()
const replaceMock = jest.fn()
const backMock = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => '/transcripts',
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: backMock,
  }),
}))

function NavHarness() {
  const guardedNav = useGuardedNavigate()
  return (
    <button type="button" onClick={() => guardedNav.push('/transcripts')}>
      go
    </button>
  )
}

// Phase 3: in-app navigation is always allowed while recording. These wrappers no
// longer prompt or discard — the dangerous boundaries are unload (beforeunload,
// app-level) and sign-out (Sidebar guard), tested elsewhere.
describe('guardedNavigation (Phase 3: in-app nav always allowed)', () => {
  beforeEach(() => {
    __resetForTesting()
    jest.restoreAllMocks()
    pushMock.mockReset()
    replaceMock.mockReset()
    backMock.mockReset()
  })

  test('GuardedLink never prompts or discards an active recording', () => {
    startMock()
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)

    render(<GuardedLink href="/transcripts">Transcripts</GuardedLink>)
    fireEvent.click(screen.getByRole('link', { name: 'Transcripts' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(getSnapshot().state).toBe('recording')
  })

  test('GuardedLink does not prompt even while finalizing or uploading', () => {
    startMock()
    forceState('uploading')
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})

    render(<GuardedLink href="/transcripts">Transcripts</GuardedLink>)
    fireEvent.click(screen.getByRole('link', { name: 'Transcripts' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(getSnapshot().state).toBe('uploading')
  })

  test('useGuardedNavigate.push routes without prompting during a recording', () => {
    startMock()
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)

    render(<NavHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'go' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/transcripts')
    expect(getSnapshot().state).toBe('recording')
  })
})
