import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { fitTranscriptTitle } from '@/core/transcripts/title'
import { CharacterCount } from '@/components/ui/character-count'
import { TEXT_LIMITS } from '@/contracts/limits'
import { SpeakerSchema, TranscriptSummarySchema, TranscriptUpdateSchema } from '@/contracts/db'

describe('fitTranscriptTitle', () => {
  test('leaves a title under the cap alone, apart from trimming', () => {
    expect(fitTranscriptTitle('  Client call 21.09  ')).toBe('Client call 21.09')
  })

  test('shortens a long filename to exactly the cap with an ellipsis', () => {
    const fitted = fitTranscriptTitle('x'.repeat(300))
    expect(fitted).toHaveLength(TEXT_LIMITS.transcriptTitle)
    expect(fitted.endsWith('…')).toBe(true)
  })

  test('never splits an emoji at the cut point', () => {
    const fitted = fitTranscriptTitle(`${'x'.repeat(118)}😀${'x'.repeat(20)}`)
    expect(fitted).toBe(`${'x'.repeat(118)}…`)
    expect(fitted.isWellFormed()).toBe(true)
  })
})

describe('CharacterCount', () => {
  test('stays hidden until 75% of the limit is used', () => {
    const { rerender } = render(<CharacterCount id="c" length={37} max={50} />)
    expect(screen.getByTestId('character-count')).toHaveClass('opacity-0')

    rerender(<CharacterCount id="c" length={38} max={50} />)
    expect(screen.getByTestId('character-count')).not.toHaveClass('opacity-0')
    expect(screen.getByTestId('character-count')).toHaveTextContent('38/50')
  })

  test('turns red past the limit', () => {
    render(<CharacterCount id="c" length={62} max={50} />)
    expect(screen.getByTestId('character-count')).toHaveTextContent(/^62\/50$/)
    expect(screen.getByTestId('character-count')).toHaveClass('text-ember-red')
  })

  test('announces the count to screen readers once typing pauses', () => {
    jest.useFakeTimers()
    try {
      render(<CharacterCount id="c" length={48} max={50} />)
      expect(screen.queryByText('2 characters remaining')).not.toBeInTheDocument()
      act(() => jest.advanceTimersByTime(1000))
      expect(screen.getByText('2 characters remaining')).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('text limits apply to writes only', () => {
  test('rows over a limit still load, so lowering a limit never hides data', () => {
    const id = '00000000-0000-4000-8000-000000000000'
    const stamp = '2026-09-23T00:00:00Z'
    const longTitle = 'x'.repeat(TEXT_LIMITS.transcriptTitle + 50)

    expect(TranscriptSummarySchema.safeParse({
      id, project_id: null, title: longTitle, status: 'completed',
      duration_seconds: 60, created_at: stamp, updated_at: stamp,
    }).success).toBe(true)
    expect(SpeakerSchema.safeParse({
      id, transcript_id: id, user_id: id, ordinal: 0,
      custom_label: 'y'.repeat(TEXT_LIMITS.speakerName + 50),
      diarization_index: null, person_id: null, created_at: stamp, updated_at: stamp,
    }).success).toBe(true)
    expect(TranscriptUpdateSchema.safeParse({ title: longTitle }).success).toBe(false)
  })
})
