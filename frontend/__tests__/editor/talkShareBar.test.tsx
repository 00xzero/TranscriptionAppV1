import React from 'react'
import { render, screen } from '@testing-library/react'
import { TalkShareBar } from '@/app/(app)/editor/[id]/components/TalkShareBar'
import { formatShare } from '@/app/(app)/editor/[id]/hooks/useSpeakerOverview'
import { SPEAKER_COLOR_FALLBACK } from '@/lib/speakers/palette'

const row = (label: string, share: number, color = '#4F638C', isUnknown = false) => ({
  key: label, label, color, share, shareLabel: formatShare(share), isUnknown,
})

const chunks = () => [...screen.getByRole('img').children] as HTMLElement[]

describe('TalkShareBar', () => {
  test('speakers under 5% join one Others chunk at the end', () => {
    render(<TalkShareBar rows={[
      row('Georgina', 0.6, '#C73E1D'), row('Will', 0.32), row('Jeff', 0.03, '#DB2777'), row('Jon', 0.02, '#CA8A04'),
    ]} />)

    expect(screen.getByRole('img')).toHaveAccessibleName('Talk time: Georgina 60%, Will 32%, Others 5%')
    expect(chunks()).toHaveLength(3)
    expect(chunks()[2]).toHaveAttribute('data-testid', 'talk-share-others')
    expect(chunks()[2].style.flexGrow).toBe('0.05')
  })

  test('a lone quiet speaker keeps their name', () => {
    render(<TalkShareBar rows={[row('Georgina', 0.97), row('Jeff', 0.03)]} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Talk time: Georgina 97%, Jeff 3%')
  })

  test('unnamed voices and Unknown at 5% or more stay grey, before Others', () => {
    render(<TalkShareBar rows={[
      row('Unknown speaker', 0.1, SPEAKER_COLOR_FALLBACK, true), row('Speaker 2', 0.2, SPEAKER_COLOR_FALLBACK),
      row('Georgina', 0.66, '#C73E1D'), row('Jeff', 0.04),
    ]} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Talk time: Georgina 66%, Speaker 2 20%, Unknown speaker 10%, Jeff 4%')
  })

  test('draws nothing when nobody has spoken', () => {
    const { container } = render(<TalkShareBar rows={[row('Georgina', 0)]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
