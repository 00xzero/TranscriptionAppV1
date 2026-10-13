import React, { createRef } from 'react'
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resolveSpeakerPresentation } from '@/core/speakers/labels'
import { buildSpeakerDisplay } from '@/lib/speakers/display'
import { SpeakersSidebar, type SpeakersSidebarHandle } from '@/app/editor/[id]/components/SpeakersSidebar'
import { useSpeakerOverview } from '@/app/editor/[id]/hooks/useSpeakerOverview'
import type { Seg, Speaker } from '@/app/editor/[id]/types'

const people = [{ id: 'p1', name: 'Paul Reyes', organisation_name: 'Acme', preferred_color: '#4F638C' }]

const speaker = (id: string, ordinal: number, extra: Partial<Speaker> = {}): Speaker => ({
  id, transcript_id: 't', user_id: 'u', ordinal, custom_label: null, diarization_index: ordinal,
  person_id: null, created_at: '', updated_at: '', ...extra,
})

const seg = (id: string, speaker_id: string | null, start_ms: number, text: string): Seg => ({
  id, transcript_id: 't', speaker_id, diarization_index: null, start_ms, end_ms: start_ms + 1000, text,
  is_edited: false, is_filler: false, algo_version: '1', revision: 0, created_at: '', updated_at: '',
})

/** Paul talks most; Speaker 2 (unnamed) has two turns; Speaker 3 one. */
const baseSpeakers = [speaker('a', 1, { person_id: 'p1' }), speaker('b', 2), speaker('c', 3)]
const baseSegments = [
  seg('s1', 'a', 0, 'Welcome, everyone.'),
  seg('s2', 'a', 1000, 'Let us start.'),
  seg('s3', 'b', 2000, 'First from me.'),
  seg('s4', 'a', 3000, 'Thanks.'),
  seg('s5', 'c', 4000, 'One question.'),
  seg('s6', 'b', 5000, 'Second from me.'),
  seg('s7', 'a', 6000, 'Good.'),
]

function overviewFor(speakers: Speaker[], segments: Seg[]) {
  const presentation = resolveSpeakerPresentation(speakers, segments, people)
  const displayForSpeaker = buildSpeakerDisplay(speakers, presentation, people)
  return renderHook(() => useSpeakerOverview({ segments, speakers, presentation, displayForSpeaker, durationSecs: 10 })).result.current
}

function renderSidebar(overview = overviewFor(baseSpeakers, baseSegments)) {
  const onJump = jest.fn()
  const onClose = jest.fn()
  const ui = (value: typeof overview) => (
    <TooltipProvider>
      <SpeakersSidebar id="speakers" open overview={value} onJump={onJump} onClose={onClose} />
    </TooltipProvider>
  )
  const view = render(ui(overview))
  return { onJump, onClose, rerender: (value: typeof overview) => view.rerender(ui(value)) }
}

const rowButton = (name: RegExp) => screen.getByRole('button', { name })

describe('SpeakersSidebar', () => {
  test('lists speakers by talk time and tags the unnamed ones', () => {
    renderSidebar()
    const rows = screen.getAllByRole('button', { name: /of talk time/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Paul Reyes, 57% of talk time',
      'Speaker 2, unnamed, 29% of talk time',
      'Speaker 3, unnamed, 14% of talk time',
    ])
    expect(screen.getByText('3 speakers · 2 unnamed')).toBeInTheDocument()
  })

  test('opening moves focus to the heading', () => {
    renderSidebar()
    expect(screen.getByRole('heading', { name: 'Speakers' })).toHaveFocus()
  })

  test('expanding a row shows its first turn without jumping', async () => {
    const { onJump } = renderSidebar()
    await userEvent.click(rowButton(/Speaker 2/))
    expect(screen.getByText('turn 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('First from me.')).toBeInTheDocument()
    expect(onJump).not.toHaveBeenCalled()
  })

  test('next and previous jump to each turn and wrap at the ends', async () => {
    const { onJump } = renderSidebar()
    await userEvent.click(rowButton(/Speaker 2/))

    await userEvent.click(screen.getByRole('button', { name: 'Next turn' }))
    expect(onJump).toHaveBeenLastCalledWith('s6')
    expect(screen.getByText('turn 2 of 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next turn' }))
    expect(onJump).toHaveBeenLastCalledWith('s3')

    await userEvent.click(screen.getByRole('button', { name: 'Previous turn' }))
    expect(onJump).toHaveBeenLastCalledWith('s6')
  })

  test('a row reopens on the turn it was left on', async () => {
    renderSidebar()
    await userEvent.click(rowButton(/Speaker 2/))
    await userEvent.click(screen.getByRole('button', { name: 'Next turn' }))
    await userEvent.click(rowButton(/Paul Reyes/))
    expect(screen.getByText('turn 1 of 3')).toBeInTheDocument()

    await userEvent.click(rowButton(/Speaker 2/))
    expect(screen.getByText('turn 2 of 2')).toBeInTheDocument()
  })

  test('reveal opens the row and turn holding a segment, without jumping', () => {
    const ref = createRef<SpeakersSidebarHandle>()
    const onJump = jest.fn()
    render(
      <TooltipProvider>
        <SpeakersSidebar ref={ref} id="speakers" open overview={overviewFor(baseSpeakers, baseSegments)} onJump={onJump} onClose={jest.fn()} />
      </TooltipProvider>
    )
    act(() => ref.current!.reveal('s6'))
    expect(rowButton(/Speaker 2/)).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('turn 2 of 2')).toBeInTheDocument()
    expect(onJump).not.toHaveBeenCalled()
  })

  describe('after a reveal', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    const renderWithRef = () => {
      const ref = createRef<SpeakersSidebarHandle>()
      const view = render(
        <TooltipProvider>
          <input aria-label="Somewhere else" />
          <SpeakersSidebar ref={ref} id="speakers" open overview={overviewFor(baseSpeakers, baseSegments)} onJump={jest.fn()} onClose={jest.fn()} />
        </TooltipProvider>
      )
      return { ref, ...view }
    }

    test('focus lands on the opened row once it has opened', () => {
      const { ref } = renderWithRef()
      act(() => ref.current!.reveal('s6'))
      act(() => { jest.advanceTimersByTime(200) })
      expect(rowButton(/Speaker 2/)).toHaveFocus()
    })

    test('a newer reveal replaces a pending one, and unmounting cancels it', () => {
      const focus = jest.spyOn(HTMLElement.prototype, 'focus')
      const { ref, unmount } = renderWithRef()
      focus.mockClear()
      act(() => { ref.current!.reveal('s3'); ref.current!.reveal('s5') })
      act(() => { jest.advanceTimersByTime(200) })
      expect(focus).toHaveBeenCalledTimes(1)
      expect(rowButton(/Speaker 3/)).toHaveFocus()

      focus.mockClear()
      act(() => ref.current!.reveal('s6'))
      unmount()
      act(() => { jest.advanceTimersByTime(200) })
      expect(focus).not.toHaveBeenCalled()
      focus.mockRestore()
    })

    test('focus the reader has moved elsewhere in the meantime is not taken', () => {
      const { ref } = renderWithRef()
      act(() => ref.current!.reveal('s6'))
      const elsewhere = screen.getByRole('textbox', { name: 'Somewhere else' })
      act(() => elsewhere.focus())
      act(() => { jest.advanceTimersByTime(200) })
      expect(elsewhere).toHaveFocus()
      // The row still opened; only the focus move was skipped.
      expect(rowButton(/Speaker 2/)).toHaveAttribute('aria-expanded', 'true')
    })
  })

  test('clicking the excerpt jumps to that turn', async () => {
    const { onJump } = renderSidebar()
    await userEvent.click(rowButton(/Paul Reyes/))
    await userEvent.click(screen.getByRole('button', { name: /Go to turn 1/ }))
    expect(onJump).toHaveBeenCalledWith('s1')
  })

  test('Escape closes the panel', async () => {
    const { onClose } = renderSidebar()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('an Escape already handled by a nested layer leaves the panel open', async () => {
    const { onClose } = renderSidebar()
    // What a Radix layer (a tooltip) does when it dismisses itself.
    const handled = (event: KeyboardEvent) => event.preventDefault()
    document.addEventListener('keydown', handled, { capture: true })
    try {
      await userEvent.keyboard('{Escape}')
    } finally {
      document.removeEventListener('keydown', handled, { capture: true })
    }
    expect(onClose).not.toHaveBeenCalled()
  })

  test('the open row and turn follow the segments through a rename, a save and an Undo', async () => {
    const { rerender } = renderSidebar()
    await userEvent.click(rowButton(/Speaker 2/))
    await userEvent.click(screen.getByRole('button', { name: 'Next turn' }))

    const expectOnSecondTurnOf = (label: RegExp) => {
      const trigger = rowButton(label)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
      const content = document.getElementById(trigger.getAttribute('aria-controls')!)!
      expect(within(content).getByText('turn 2 of 2')).toBeInTheDocument()
      expect(within(content).getByText('Second from me.')).toBeInTheDocument()
    }

    // Naming a detected speaker moves its segments to a new, provisional speaker.
    const moved = (to: string) => baseSegments.map((segment) => segment.speaker_id === 'b' ? { ...segment, speaker_id: to } : segment)
    rerender(overviewFor([...baseSpeakers, speaker('tmp', 4, { custom_label: 'Priya' })], moved('tmp')))
    expectOnSecondTurnOf(/Priya/)

    // The save swaps the provisional id for the saved one.
    rerender(overviewFor([...baseSpeakers, speaker('saved', 4, { custom_label: 'Priya' })], moved('saved')))
    expectOnSecondTurnOf(/Priya/)

    // Undo moves the segments back.
    rerender(overviewFor(baseSpeakers, baseSegments))
    expectOnSecondTurnOf(/Speaker 2/)
  })
})
