import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  GuardedLink,
  useGuardedNavigate,
  usePopStateGuard,
} from '@/lib/recording/guardedNavigation'
import {
  __resetForTesting,
  getSnapshot,
  startMock,
} from '@/lib/recording/session'

const pushMock = jest.fn()
const replaceMock = jest.fn()
const backMock = jest.fn()
let pathnameMock = '/projects'

jest.mock('next/navigation', () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: backMock,
  }),
}))

function PopStateGuardHarness() {
  usePopStateGuard()
  return null
}

function ConfirmBeforeLeaveHarness({
  onResult,
}: {
  onResult: (result: boolean) => void
}) {
  const guardedNav = useGuardedNavigate()
  return (
    <button type="button" onClick={() => onResult(guardedNav.confirmBeforeLeave())}>
      confirm
    </button>
  )
}

describe('GuardedLink', () => {
  beforeEach(() => {
    __resetForTesting()
    jest.restoreAllMocks()
    pushMock.mockReset()
    replaceMock.mockReset()
    backMock.mockReset()
    pathnameMock = '/projects'
  })

  test('same-tab navigation prompts before discarding an active recording', () => {
    startMock()
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)

    render(<GuardedLink href="/projects">Projects</GuardedLink>)
    fireEvent.click(screen.getByRole('link', { name: 'Projects' }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(getSnapshot().state).toBe('discarded')
  })

  test('background-tab interactions do not prompt or discard an active recording', () => {
    startMock()
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <>
        <GuardedLink href="/projects">Projects</GuardedLink>
        <GuardedLink href="/projects" target="_blank">
          New tab
        </GuardedLink>
      </>
    )

    fireEvent.click(screen.getByRole('link', { name: 'Projects' }), {
      metaKey: true,
    })
    fireEvent.click(screen.getByRole('link', { name: 'Projects' }), {
      button: 1,
    })
    fireEvent.click(screen.getByRole('link', { name: 'New tab' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(getSnapshot().state).toBe('recording')
  })

  test('canceling browser back restores the recording route in the app router', () => {
    pathnameMock = '/recording/new'
    startMock()
    jest.spyOn(window, 'confirm').mockReturnValue(false)
    const pushStateSpy = jest.spyOn(window.history, 'pushState')

    render(<PopStateGuardHarness />)
    fireEvent.popState(window)

    expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/recording/new')
    expect(replaceMock).toHaveBeenCalledWith('/recording/new')
    expect(getSnapshot().state).toBe('recording')
  })

  test('confirmBeforeLeave cancels without discarding when the user declines', () => {
    startMock()
    jest.spyOn(window, 'confirm').mockReturnValue(false)
    const onResult = jest.fn()

    render(<ConfirmBeforeLeaveHarness onResult={onResult} />)
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }))

    expect(onResult).toHaveBeenCalledWith(false)
    expect(getSnapshot().state).toBe('recording')
  })
})
