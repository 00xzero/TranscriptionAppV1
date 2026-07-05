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

describe('Tooltip', () => {
  test('closes an open tooltip when the window loses focus', async () => {
    const user = userEventLib.setup()
    renderTooltip()

    await user.hover(screen.getByRole('button', { name: 'Toggle sidebar' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Expand Sidebar')

    fireEvent.blur(window)

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
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
})
