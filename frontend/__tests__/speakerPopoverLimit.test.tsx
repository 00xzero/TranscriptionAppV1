import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SpeakerPopoverContent from '@/components/SpeakerPopoverContent'
import type { Speaker } from '@/contracts/db'

const speaker: Speaker = {
  id: '00000000-0000-4000-8000-000000000001',
  transcript_id: '00000000-0000-4000-8000-000000000002',
  label: 'Georgina Carter',
  color: null,
  created_at: '2026-09-23T00:00:00Z',
  updated_at: '2026-09-23T00:00:00Z',
}

function renderPopover(overrides: Partial<React.ComponentProps<typeof SpeakerPopoverContent>> = {}) {
  const props = {
    speakers: [speaker],
    currentSpeaker: speaker,
    onSelectSpeaker: jest.fn(),
    onCreateSpeaker: jest.fn(),
    onRenameSpeaker: jest.fn(),
    onUntag: jest.fn(),
    getColorForSpeaker: () => '#000',
    onHoldOpenChange: jest.fn(),
    ...overrides,
  }
  render(<SpeakerPopoverContent {...props} />)
  return props
}

describe('SpeakerPopoverContent name limit', () => {
  test('an over-long new name is not tagged, and holds the popover open', async () => {
    const user = userEvent.setup()
    const props = renderPopover()
    const input = screen.getByLabelText('Search speakers or type a new speaker name')

    await user.click(input)
    await user.paste('y'.repeat(55))
    await user.keyboard('{Enter}')

    expect(props.onCreateSpeaker).not.toHaveBeenCalled()
    expect(input).toHaveValue('y'.repeat(55))
    expect(screen.getByRole('alert')).toHaveTextContent('Speaker names must be 50 characters or fewer.')
    expect(props.onHoldOpenChange).toHaveBeenLastCalledWith(true)
  })

  test('an over-long rename stays in edit mode on blur instead of saving', async () => {
    const user = userEvent.setup()
    const props = renderPopover()

    await user.click(screen.getByRole('button', { name: /Current speaker Georgina Carter/ }))
    const rename = screen.getByLabelText('Rename speaker Georgina Carter')
    await user.clear(rename)
    await user.paste('z'.repeat(60))
    await user.tab()

    expect(props.onRenameSpeaker).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Rename speaker Georgina Carter')).toHaveValue('z'.repeat(60))
    expect(screen.getByRole('alert')).toHaveTextContent('Speaker names must be 50 characters or fewer.')
  })
})
