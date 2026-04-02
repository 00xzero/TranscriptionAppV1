import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import ContextualHeader from '../components/ContextualHeader'
import { TooltipProvider } from '../components/ui/tooltip'

const usePathnameMock = jest.fn()
const openCaptureModalMock = jest.fn()
const getUserMock = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
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
  })

  test('dispatches editor-scroll-to-top when the project breadcrumb is activated', async () => {
    const user = userEventLib.setup()
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent')

    renderHeader()

    const button = await waitFor(() =>
      screen.getByRole('button', { name: /scroll to the top of the project/i })
    )

    await user.click(button)

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'editor-scroll-to-top',
    }))
    expect(button).toHaveTextContent('Project')
  })

  test('does not query Supabase auth on auth routes', async () => {
    usePathnameMock.mockReturnValue('/auth')

    renderHeader()

    expect(await screen.findByText('olivetti')).toBeInTheDocument()
    expect(getUserMock).not.toHaveBeenCalled()
  })
})
