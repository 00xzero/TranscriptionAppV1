import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SpeakerPopoverContent, { rankPeople } from '@/components/SpeakerPopoverContent'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resolveSpeakerPresentation } from '@/core/speakers/labels'
import { buildSpeakerDisplay } from '@/lib/speakers/display'
import type { EditorPeopleContext, Speaker } from '@/contracts/db'
import type { Seg } from '@/app/editor/[id]/types'

const stamp = '2026-01-01T00:00:00Z'
const speaker: Speaker = { id: 's1', transcript_id: 't1', user_id: 'u1', ordinal: 0,
  custom_label: null, diarization_index: 0, person_id: null, created_at: stamp, updated_at: stamp }
const segment: Seg = { id: 'seg1', transcript_id: 't1', speaker_id: 's1', diarization_index: 0, start_ms: 1000,
  end_ms: 2000, text: 'Hello', is_edited: false, is_filler: false, algo_version: 'test',
  created_at: stamp, updated_at: stamp }
const peopleContext: EditorPeopleContext = { people: [
  { id: 'p1', user_id: 'u1', name: 'Alex', organisation_id: null, organisation_name: 'Example Org',
    preferred_color: '#4F638C', hidden: false, created_at: stamp, updated_at: stamp,
    last_other_title: 'Review', last_other_seen_at: '2026-09-12T00:00:00Z', other_transcript_count: 1, in_project: false },
  { id: 'p2', user_id: 'u1', name: 'Alex', organisation_id: null, organisation_name: null,
    preferred_color: '#C73E1D', hidden: true, created_at: stamp, updated_at: stamp,
    last_other_title: null, last_other_seen_at: null, other_transcript_count: 0, in_project: false },
] }

const nothingToRemove = { speaker: false, segment: false, turn: false }

function renderPopover({ speakers = [speaker], segments = [segment], ...overrides }:
  Partial<React.ComponentProps<typeof SpeakerPopoverContent>> & { speakers?: Speaker[]; segments?: Seg[] } = {}) {
  // An explicit `currentSpeaker: undefined` means an unassigned segment.
  const currentSpeaker = 'currentSpeaker' in overrides ? overrides.currentSpeaker : speaker
  const people = (overrides.peopleContext ?? peopleContext).people
  const presentation = resolveSpeakerPresentation(speakers, segments, people)
  const selectedSegment = segments[0]
  const props = {
    presentation, peopleContext, currentSpeaker, removable: nothingToRemove,
    scopes: {
      speaker: currentSpeaker ? segments.filter((row) => row.speaker_id === currentSpeaker.id) : [],
      segment: [selectedSegment], turn: [selectedSegment],
    },
    labelForSpeaker: (id: string | null) => presentation.labels.get(id ?? '') ?? 'Unknown speaker',
    displayForSpeaker: buildSpeakerDisplay(speakers, presentation, people),
    onSelectTarget: jest.fn(), onRemove: jest.fn(), onRenameLocal: jest.fn(), onRenamePerson: jest.fn(),
    onHoldOpenChange: jest.fn(), ...overrides,
  }
  render(<TooltipProvider delayDuration={0}><SpeakerPopoverContent {...props} /></TooltipProvider>)
  return { ...props, user: userEvent.setup() }
}

test('a generic voice applies to every segment by default, and one click applies', async () => {
  const { user, onSelectTarget } = renderPopover()
  expect(screen.getByRole('tab', { name: 'All 1 segment' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('combobox', { name: 'Search or add a person' })).toHaveFocus()
  await user.click(screen.getByRole('option', { name: /Alex/ }))
  expect(onSelectTarget).toHaveBeenCalledWith({ kind: 'person', id: 'p1' }, 'speaker')
})

test('a named voice applies to this segment by default and offers Remove and other voices', async () => {
  const host = { ...speaker, custom_label: 'Host', diarization_index: null, ordinal: 2 }
  const guest = { ...speaker, id: 's2', ordinal: 1, diarization_index: 1 }
  const { user, onSelectTarget, onRemove } = renderPopover({ speakers: [host, guest], currentSpeaker: host,
    removable: { speaker: true, segment: true, turn: true },
    segments: [segment, { ...segment, id: 'seg2', speaker_id: 's2', start_ms: 3000 }] })
  expect(screen.getByRole('tab', { name: 'This segment' })).toHaveAttribute('aria-selected', 'true')
  await user.hover(screen.getByRole('tab', { name: 'This segment' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent(/Splitting isn.t available yet/)
  await user.click(screen.getByRole('option', { name: 'Speaker 1' }))
  expect(onSelectTarget).toHaveBeenLastCalledWith({ kind: 'speaker', id: 's2' }, 'segment')
  screen.getByRole('tab', { name: 'This segment' }).focus()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'This turn · 1' })).toHaveAttribute('aria-selected', 'true')
  await user.click(screen.getByRole('button', { name: 'Remove Host from this turn' }))
  expect(onRemove).toHaveBeenLastCalledWith('turn')
})

test('the Current row and Remove stay while searching', async () => {
  const host = { ...speaker, custom_label: 'Host', diarization_index: null, ordinal: 2 }
  const { user } = renderPopover({ speakers: [host], currentSpeaker: host,
    removable: { speaker: true, segment: true, turn: true } })
  await user.type(screen.getByRole('combobox'), 'Al')
  expect(screen.getByRole('button', { name: 'Remove Host from this segment' })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Results' })).toHaveTextContent('Alex')
})

test('Remove is not offered where every segment is already on its detected speaker', async () => {
  const { user } = renderPopover()
  expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'This segment' }))
  expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
})

test('other voices are not offered when applying to every segment', () => {
  const guest = { ...speaker, id: 's2', ordinal: 1 }
  renderPopover({ speakers: [speaker, guest],
    segments: [segment, { ...segment, id: 'seg2', speaker_id: 's2', start_ms: 3000 }] })
  expect(screen.queryByRole('option', { name: /Speaker 1/ })).not.toBeInTheDocument()
})

test('typing searches, a hidden namesake is discoverable, and Enter picks the best match', async () => {
  const { user, onSelectTarget } = renderPopover()
  await user.type(screen.getByRole('combobox'), 'Alex')
  expect(screen.getByRole('option', { name: 'Create another “Alex”' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add another' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Hidden (1)' }))
  expect(screen.getAllByRole('option', { name: /^Alex/ })).toHaveLength(2)
  await user.click(screen.getByRole('combobox'))
  await user.keyboard('{Enter}')
  expect(onSelectTarget).toHaveBeenCalledWith({ kind: 'person', id: 'p1' }, 'speaker')
})

test('a search keeps namesakes in this transcript apart, as the page shows them', async () => {
  // Two new people called Paul, both in this transcript: no organisation or
  // history to tell them apart, only the transcript's `Paul (2)` and colours.
  const paul = (id: string, preferred_color: string) => ({ ...peopleContext.people[0], id, name: 'Paul',
    organisation_name: null, preferred_color, last_other_title: null, last_other_seen_at: null })
  const people = [paul('pa', '#4F638C'), paul('pb', '#4F638C')]
  const linkedTo = (id: string, person_id: string, ordinal: number) =>
    ({ ...speaker, id, ordinal, diarization_index: null, person_id })
  const speakers = [speaker, linkedTo('sa', 'pa', 2), linkedTo('sb', 'pb', 3)]
  const segments = [segment, { ...segment, id: 'seg2', speaker_id: 'sa', start_ms: 3000 },
    { ...segment, id: 'seg3', speaker_id: 'sb', start_ms: 5000 }]
  const { user, displayForSpeaker } = renderPopover({ speakers, segments, peopleContext: { people } })
  const shown = () => screen.getAllByRole('option', { name: /^Paul/ })
    .map((option) => [option.querySelector('.text-sm')?.textContent, option.querySelector('[aria-hidden]')?.getAttribute('style')])
  const before = shown()
  expect(before.map(([text]) => text)).toEqual(['Paul', 'Paul (2)'])
  await user.type(screen.getByRole('combobox'), 'Paul')
  expect(shown()).toEqual(before)
  // Both prefer the same colour; the page gives the second another one.
  expect(displayForSpeaker('sb').color).not.toBe(displayForSpeaker('sa').color)
})

test('arrow keys move to Create, and a new person is created in one step', async () => {
  const { user, onSelectTarget } = renderPopover()
  await user.type(screen.getByRole('combobox'), 'Alex')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(onSelectTarget).toHaveBeenLastCalledWith({ kind: 'new-person', name: 'Alex' }, 'speaker')
  await user.clear(screen.getByRole('combobox'))
  await user.type(screen.getByRole('combobox'), 'Blair')
  await user.click(screen.getByRole('button', { name: 'Add' }))
  expect(onSelectTarget).toHaveBeenLastCalledWith({ kind: 'new-person', name: 'Blair' }, 'speaker')
})

test('a name over 50 characters cannot be created', async () => {
  const { user, onSelectTarget, onHoldOpenChange } = renderPopover()
  await user.type(screen.getByRole('combobox'), 'x'.repeat(51))
  expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('alert')).toHaveTextContent('50 characters or fewer')
  expect(onSelectTarget).not.toHaveBeenCalled()
  expect(onHoldOpenChange).toHaveBeenLastCalledWith(true)
})

test('a linked speaker can be removed everywhere and renamed everywhere', async () => {
  const linked = { ...speaker, person_id: 'p1', diarization_index: null }
  const { user, onRemove, onRenamePerson } = renderPopover({ speakers: [linked], currentSpeaker: linked,
    removable: { speaker: true, segment: true, turn: true } })
  expect(screen.getByRole('tab', { name: 'This segment' })).toHaveAttribute('aria-selected', 'true')
  await user.click(screen.getByRole('tab', { name: 'All 1 segment' }))
  await user.click(screen.getByRole('button', { name: 'Remove Alex' }))
  expect(onRemove).toHaveBeenCalledWith('speaker')
  await user.click(screen.getByRole('button', { name: 'Rename person everywhere' }))
  const input = screen.getByLabelText('Rename person everywhere · 2 transcripts')
  expect(input).toHaveValue('Alex')
  await user.clear(input)
  await user.type(input, 'Alexa{Enter}')
  expect(onRenamePerson).toHaveBeenCalledWith('Alexa')
})

test('renaming in this transcript needs a name and can use an existing person instead', async () => {
  const host = { ...speaker, custom_label: 'Host', diarization_index: null }
  const { user, onRenameLocal, onSelectTarget } = renderPopover({ speakers: [host], currentSpeaker: host })
  await user.click(screen.getByRole('button', { name: 'Rename in this transcript' }))
  const input = screen.getByLabelText('Rename in this transcript only')
  await user.clear(input)
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  await user.type(input, 'alex')
  await user.click(screen.getByRole('button', { name: 'Use existing person: Alex · Example Org' }))
  expect(onSelectTarget).toHaveBeenCalledWith({ kind: 'person', id: 'p1' }, 'speaker')
  await user.clear(input)
  await user.type(input, ' Guest {Enter}')
  expect(onRenameLocal).toHaveBeenCalledWith('Guest')
})

test('an unassigned segment can only be corrected as a passage', () => {
  renderPopover({ segments: [{ ...segment, speaker_id: null }], currentSpeaker: undefined })
  expect(screen.queryByRole('tab', { name: /All/ })).not.toBeInTheDocument()
  expect(screen.getByText('Unknown speaker')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Rename/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Remove speaker/ })).not.toBeInTheDocument()
})

test('a person row shows organisation and where they were last seen', () => {
  renderPopover()
  expect(screen.getByRole('option', { name: /Alex/ })).toHaveTextContent(/Example Org · last in “Review”/)
})

test('picker orders transcript identities by first appearance, then project and recent', () => {
  const person = peopleContext.people[0]
  const ranked = rankPeople([
    { ...person, id: 'recent', name: 'Recent Person', last_other_seen_at: '2026-09-20T00:00:00Z' },
    { ...person, id: 'older', name: 'Older Person', last_other_seen_at: '2026-09-01T00:00:00Z' },
    { ...person, id: 'project', name: 'Project Person', in_project: true, last_other_seen_at: null },
    { ...person, id: 'second', name: 'Second Here' },
    { ...person, id: 'first', name: 'First Here' },
  ], ['first', 'second'])
  expect(ranked.map((entry) => entry.id)).toEqual(['first', 'second', 'project', 'recent', 'older'])
})
