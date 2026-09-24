import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SpeakerPopoverContent from '@/components/SpeakerPopoverContent'
import type { Speaker } from '@/contracts/db'

const makeSpeaker = (overrides: Partial<Speaker>): Speaker => ({
  id: '00000000-0000-4000-8000-000000000001',
  transcript_id: '00000000-0000-4000-8000-000000000010',
  user_id: '00000000-0000-4000-8000-000000000020',
  ordinal: 0,
  custom_label: null,
  diarization_index: 0,
  created_at: '2026-09-23T00:00:00Z',
  updated_at: '2026-09-23T00:00:00Z',
  ...overrides,
})

const generic = makeSpeaker({ id: '00000000-0000-4000-8000-000000000001', ordinal: 0 })
const named = makeSpeaker({ id: '00000000-0000-4000-8000-000000000002', ordinal: 1, custom_label: 'Alex' })
const namesake = makeSpeaker({ id: '00000000-0000-4000-8000-000000000003', ordinal: 2, custom_label: 'Alex' })

// Stands in for the transcript's resolved labels (core/speakers/labels.ts).
const labels = new Map([
  [generic.id, 'Speaker 0'],
  [named.id, 'Alex'],
  [namesake.id, 'Alex (2)'],
])

function renderPopover(currentSpeaker: Speaker) {
  const props = {
    speakers: [generic, named, namesake],
    currentSpeaker,
    onSelectSpeaker: jest.fn(),
    onCreateSpeaker: jest.fn(),
    onRenameSpeaker: jest.fn(),
    onUntag: jest.fn(),
    getColorForSpeaker: () => '#000',
    labelForSpeaker: (id: string) => labels.get(id) ?? '',
  }
  render(<SpeakerPopoverContent {...props} />)
  return props
}

describe('SpeakerPopoverContent labels', () => {
  test('lists every speaker under its resolved label', () => {
    renderPopover(generic)

    expect(screen.getByRole('button', { name: 'Current speaker Speaker 0. Activate to rename' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign speaker Alex' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign speaker Alex (2)' })).toBeInTheDocument()
  })

  test('typing a resolved label picks that exact speaker', async () => {
    const user = userEvent.setup()
    const props = renderPopover(generic)

    await user.type(screen.getByLabelText('Search speakers or type a new speaker name'), 'alex (2){Enter}')

    expect(props.onSelectSpeaker).toHaveBeenCalledWith(namesake)
    expect(props.onCreateSpeaker).not.toHaveBeenCalled()
  })

  test('offers reset only for a speaker with a custom label', () => {
    renderPopover(generic)
    expect(screen.queryByRole('button', { name: 'Reset speaker to a generic name' })).not.toBeInTheDocument()
  })

  test('reset hands the named speaker to onUntag', async () => {
    const user = userEvent.setup()
    const props = renderPopover(named)

    await user.click(screen.getByRole('button', { name: 'Reset speaker to a generic name' }))

    expect(props.onUntag).toHaveBeenCalledWith(named)
  })

  test('renaming to the label the speaker already shows saves nothing', async () => {
    const user = userEvent.setup()
    const props = renderPopover(generic)

    await user.click(screen.getByRole('button', { name: 'Current speaker Speaker 0. Activate to rename' }))
    const field = screen.getByLabelText('Rename speaker Speaker 0')
    expect(field).toHaveValue('Speaker 0')
    await user.type(field, '{Enter}')

    expect(props.onRenameSpeaker).not.toHaveBeenCalled()
  })

  test('renaming a numbered speaker edits its own name, not the display suffix', async () => {
    const user = userEvent.setup()
    const props = renderPopover(namesake)

    await user.click(screen.getByRole('button', { name: 'Current speaker Alex (2). Activate to rename' }))
    const field = screen.getByLabelText('Rename speaker Alex (2)')
    expect(field).toHaveValue('Alex')

    // Submitting the unchanged name saves nothing.
    await user.type(field, '{Enter}')
    expect(props.onRenameSpeaker).not.toHaveBeenCalled()
  })

  test('a changed name is saved without the suffix', async () => {
    const user = userEvent.setup()
    const props = renderPopover(namesake)

    await user.click(screen.getByRole('button', { name: 'Current speaker Alex (2). Activate to rename' }))
    await user.type(screen.getByLabelText('Rename speaker Alex (2)'), 'is{Enter}')

    expect(props.onRenameSpeaker).toHaveBeenCalledWith(namesake, 'Alexis')
  })
})
