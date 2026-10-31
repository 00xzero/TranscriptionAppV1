import React from 'react'
import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { GuardedLink, useGuardedNavigate } from '@/lib/recording/guardedNavigation'
import { setLeaveGuard } from '@/lib/editor/leaveGuard'

const routerPushMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
}))
// Next's Link navigates by itself unless onNavigate prevents it.
const linkNavigateMock = jest.fn()
jest.mock('next/link', () => {
  function MockNextLink({ children, href, onNavigate }: {
    children: React.ReactNode; href: string; onNavigate?: (event: { preventDefault(): void }) => void
  }) {
    return (
      <a href={href} onClick={(e) => {
        e.preventDefault()
        let prevented = false
        onNavigate?.({ preventDefault: () => { prevented = true } })
        if (!prevented) linkNavigateMock(href)
      }}>{children}</a>
    )
  }
  return { __esModule: true, default: MockNextLink }
})

describe('guarded navigation', () => {
  beforeEach(() => jest.clearAllMocks())

  it('navigates at once when no editor holds it', () => {
    const { result } = renderHook(() => useGuardedNavigate())
    result.current.push('/people')
    expect(routerPushMock).toHaveBeenCalledWith('/people')

    render(<GuardedLink href="/projects">Projects</GuardedLink>)
    fireEvent.click(screen.getByText('Projects'))
    expect(linkNavigateMock).toHaveBeenCalledWith('/projects')
  })

  it('hands the navigation to an editor with work not saved, which goes when it may', () => {
    const leave = jest.fn()
    const remove = setLeaveGuard({ pending: () => true, leave, unsavedTexts: () => [] })
    try {
      const { result } = renderHook(() => useGuardedNavigate())
      result.current.push('/people')
      expect(routerPushMock).not.toHaveBeenCalled()
      leave.mock.calls[0][0]()
      expect(routerPushMock).toHaveBeenCalledWith('/people')

      // A link's destination goes to the editor, which navigates there itself.
      render(<GuardedLink href="/projects" replace>Projects</GuardedLink>)
      fireEvent.click(screen.getByText('Projects'))
      expect(linkNavigateMock).not.toHaveBeenCalled()
      expect(leave).toHaveBeenLastCalledWith({ href: '/projects', replace: true, scroll: undefined })
    } finally {
      remove()
    }
  })

  it('lets navigation through once the editor has nothing waiting', () => {
    const remove = setLeaveGuard({ pending: () => false, leave: jest.fn(), unsavedTexts: () => [] })
    try {
      const { result } = renderHook(() => useGuardedNavigate())
      result.current.push('/people')
      expect(routerPushMock).toHaveBeenCalledWith('/people')
    } finally {
      remove()
    }
  })
})
