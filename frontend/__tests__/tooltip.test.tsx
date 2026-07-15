import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

function renderTooltip() {
  return render(
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button">Toggle sidebar</button>
        </TooltipTrigger>
        <TooltipContent>Expand Sidebar</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function renderTooltipDropdown() {
  return render(
    <TooltipProvider delayDuration={0}>
      <button type="button">Outside target</button>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More options">
                Options
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More options</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
}

function NavbarTooltip({ disabled }: { disabled: boolean }) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip disabled={disabled}>
        <TooltipTrigger asChild>
          <button type="button">Library</button>
        </TooltipTrigger>
        <TooltipContent>Library tooltip</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

describe('Tooltip', () => {
  test('closes an open tooltip when the window loses focus', async () => {
    const user = userEventLib.setup()
    renderTooltip()

    const trigger = screen.getByRole('button', { name: 'Toggle sidebar' })
    await user.hover(trigger)

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Expand Sidebar')

    fireEvent.blur(window)

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    // Browsers restore window and trigger focus when their tab becomes active.
    // Neither restoration may resurrect the tooltip without fresh intent.
    fireEvent.focus(window)
    fireEvent.focus(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('closes an open tooltip when the page is hidden', async () => {
    const user = userEventLib.setup()
    renderTooltip()

    await user.hover(screen.getByRole('button', { name: 'Toggle sidebar' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Expand Sidebar')

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })

    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.focus(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('does not leave a tooltip open after a dropdown trigger is clicked and dismissed', async () => {
    const user = userEventLib.setup()
    renderTooltipDropdown()

    await user.hover(screen.getByRole('button', { name: 'More options' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('More options')

    await user.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    fireEvent.pointerDown(document.body)

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('does not resurrect a stale navbar tooltip after being disabled and re-enabled', async () => {
    const user = userEventLib.setup()
    const { rerender } = render(<NavbarTooltip disabled={false} />)

    await user.hover(screen.getByRole('button', { name: 'Library' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Library tooltip')

    rerender(<NavbarTooltip disabled />)
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    await user.unhover(screen.getByRole('button', { name: 'Library' }))
    rerender(<NavbarTooltip disabled={false} />)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
