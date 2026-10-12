import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import TranscriptSegmentCard, { type TranscriptSegmentCardProps } from '@/app/editor/[id]/components/TranscriptSegmentCard'
import { createPlaybackClock } from '@/app/editor/[id]/playbackClock'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Seg } from '@/app/editor/[id]/types'

const segment: Seg = {
  id: 's1', transcript_id: 't1', speaker_id: null, diarization_index: null,
  start_ms: 1000, end_ms: 3000, text: 'Hello there, friend.',
  is_edited: false, is_filler: false, algo_version: 'test',
  created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z',
}

const sourceWords = [
  { text: 'Hello', startMs: 1000, endMs: 1300 },
  { text: 'there,', startMs: 1500, endMs: 1900 },
  { text: 'friend.', startMs: 2200, endMs: 3000 },
]

function setup(overrides: Partial<TranscriptSegmentCardProps> = {}) {
  let ms = 0
  const clock = createPlaybackClock()
  clock.attach(() => ms)
  const onWordClick = jest.fn()
  const props: TranscriptSegmentCardProps = {
    segment,
    sourceWords,
    isActive: true,
    playbackClock: clock,
    matchesForSeg: [],
    matchIndex: -1,
    speaker: { label: 'Speaker 1', identityKey: 'sp1', color: '#4F638C', avatarText: 'S1', organisation: null },
    needHeader: true,
    editingId: null,
    editingTexts: {},
    saveStatus: {},
    onSegmentClick: jest.fn(),
    onWordClick,
    onSpeakerClick: jest.fn(),
    setEditingId: jest.fn(),
    setEditingTexts: jest.fn(),
    scheduleSave: jest.fn(),
    ...overrides,
  }
  const view = render(<TooltipProvider><TranscriptSegmentCard {...props} /></TooltipProvider>)
  const moveTo = (next: number) => {
    ms = next
    act(() => clock.refresh())
  }
  const rerender = (next: Partial<TranscriptSegmentCardProps>) =>
    view.rerender(<TooltipProvider><TranscriptSegmentCard {...props} {...next} /></TooltipProvider>)
  return { moveTo, onWordClick, rerender }
}

const word = (text: string) => screen.getByText(text, { selector: 'span' })
const state = (text: string) => {
  const cls = word(text).className
  if (cls.includes('text-ember-red')) return 'current'
  if (cls.includes('text-muted')) return 'upcoming'
  return 'plain'
}

it('marks spoken, current and upcoming words in the current segment', () => {
  const { moveTo } = setup()
  moveTo(1600)
  expect([state('Hello'), state('there,'), state('friend.')]).toEqual(['plain', 'current', 'upcoming'])
  moveTo(2500)
  expect([state('Hello'), state('there,'), state('friend.')]).toEqual(['plain', 'plain', 'current'])
})

it('leaves words plain before anything has played', () => {
  setup()
  expect([state('Hello'), state('there,'), state('friend.')]).toEqual(['plain', 'plain', 'plain'])
})

it('leaves words plain in a segment that is not current', () => {
  const { moveTo } = setup({ isActive: false })
  moveTo(1600)
  expect([state('Hello'), state('there,'), state('friend.')]).toEqual(['plain', 'plain', 'plain'])
})

it('shows no highlight without stored word timings, but still aims clicks as before', () => {
  const { moveTo, onWordClick } = setup({ sourceWords: undefined })
  moveTo(1600)
  expect([state('Hello'), state('there,'), state('friend.')]).toEqual(['plain', 'plain', 'plain'])

  // An even spread across 1000–3000ms, as before word timings existed.
  fireEvent.click(word('friend.'))
  expect(onWordClick).toHaveBeenCalledWith('s1', 2333)

  const empty = setup({ sourceWords: [] })
  empty.moveTo(1600)
  expect(document.querySelector('.text-ember-red')).toBeNull()
})

it('shows no highlight while the segment is being edited', () => {
  const { moveTo, rerender } = setup()
  moveTo(1600)
  expect(state('there,')).toBe('current')

  rerender({ editingId: 's1' })
  expect(screen.getByRole('textbox')).toBeInTheDocument()
  expect(document.querySelector('.text-ember-red')).toBeNull()

  rerender({ editingId: null })
  expect(state('there,')).toBe('current')
})

it("seeks to a word's real start time", () => {
  const { onWordClick } = setup()
  fireEvent.click(word('friend.'))
  expect(onWordClick).toHaveBeenCalledWith('s1', 2200)
})

it('keeps exact timing for words that survive an edit', () => {
  const { onWordClick } = setup({ segment: { ...segment, text: 'Hello there, my friend.' } })
  fireEvent.click(word('friend.'))
  expect(onWordClick).toHaveBeenLastCalledWith('s1', 2200)
  fireEvent.click(word('my'))
  expect(onWordClick).toHaveBeenLastCalledWith('s1', 1900)
})

it('still lines search highlights up with the text', () => {
  setup({ matchesForSeg: [{ index: 6, length: 5, matchIdx: 0 }], matchIndex: 0 })
  const highlighted = document.querySelector('.bg-warm-highlight')
  expect(highlighted?.textContent).toBe('there')
})
