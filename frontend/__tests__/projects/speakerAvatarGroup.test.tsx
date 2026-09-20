import React from 'react'
import { render, screen } from '@testing-library/react'
import type { ProjectSpeakerPreview } from '@/contracts/db'
import { SpeakerAvatarGroup } from '@/components/Projects/SpeakerAvatarGroup'
import { SPEAKER_COLORS } from '@/lib/speakers/palette'

const preview = (overrides: Partial<ProjectSpeakerPreview> = {}): ProjectSpeakerPreview => ({
  id: '11111111-1111-1111-1111-111111111111',
  transcriptId: '22222222-2222-2222-2222-222222222222',
  label: 'Kate',
  color: null,
  paletteIndex: 0,
  ...overrides,
})

const previews = (labels: string[]): ProjectSpeakerPreview[] =>
  labels.map((label, index) =>
    preview({
      id: `speaker-${index}`,
      label,
      paletteIndex: index,
    })
  )

const circles = (container: HTMLElement) => container.querySelectorAll('.rounded-full')

describe('SpeakerAvatarGroup', () => {
  test.each([1, 2, 3, 4])('renders one circle per speaker for %i speakers', (count) => {
    const labels = ['Kate', 'John', 'Sarah', 'Mark'].slice(0, count)
    const { container } = render(
      <SpeakerAvatarGroup speakers={previews(labels)} totalCount={count} size="card" />
    )

    expect(circles(container)).toHaveLength(count)
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  // Five speakers cannot fit five circles, so the last slot becomes the badge.
  test('shows three avatars and a +N badge beyond four speakers', () => {
    const { container } = render(
      <SpeakerAvatarGroup
        speakers={previews(['Kate', 'John', 'Sarah', 'Mark'])}
        totalCount={7}
        size="card"
      />
    )

    expect(circles(container)).toHaveLength(4)
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.queryByTitle('Mark')).not.toBeInTheDocument()
  })

  test('renders the count with no circles for zero speakers', () => {
    const { container } = render(
      <SpeakerAvatarGroup speakers={[]} totalCount={0} size="card" />
    )

    expect(circles(container)).toHaveLength(0)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '0 speakers')
  })

  test('uses singular and plural count labels', () => {
    const { rerender } = render(
      <SpeakerAvatarGroup speakers={previews(['Kate'])} totalCount={1} size="card" />
    )
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '1 speaker: Kate')

    rerender(
      <SpeakerAvatarGroup speakers={previews(['Kate', 'John'])} totalCount={2} size="card" />
    )
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '2 speakers: Kate and John')
  })

  describe('colors', () => {
    test('uses the palette position from the RPC', () => {
      render(
        <SpeakerAvatarGroup
          speakers={[preview({ label: 'Kate', paletteIndex: 2 })]}
          totalCount={1}
          size="card"
        />
      )

      expect(screen.getByTitle('Kate')).toHaveStyle({ backgroundColor: SPEAKER_COLORS[2] })
    })

    test('a stored color overrides the palette position', () => {
      render(
        <SpeakerAvatarGroup
          speakers={[preview({ label: 'Kate', color: '#FF0000', paletteIndex: 2 })]}
          totalCount={1}
          size="card"
        />
      )

      expect(screen.getByTitle('Kate')).toHaveStyle({ backgroundColor: '#FF0000' })
    })

    test('wraps past the end of the palette', () => {
      render(
        <SpeakerAvatarGroup
          speakers={[preview({ label: 'Kate', paletteIndex: SPEAKER_COLORS.length })]}
          totalCount={1}
          size="card"
        />
      )

      expect(screen.getByTitle('Kate')).toHaveStyle({ backgroundColor: SPEAKER_COLORS[0] })
    })
  })

  describe('accessibility', () => {
    test('names the group once, including the speakers beyond the badge', () => {
      render(
        <SpeakerAvatarGroup
          speakers={previews(['Kate', 'John', 'Sarah', 'Mark'])}
          totalCount={6}
          size="card"
        />
      )

      expect(screen.getByRole('img')).toHaveAttribute(
        'aria-label',
        '6 speakers: Kate, John, Sarah and 3 more'
      )
    })

    test('hides the initials, the badge and the visible count from assistive tech', () => {
      const { container } = render(
        <SpeakerAvatarGroup
          speakers={previews(['Kate', 'John', 'Sarah', 'Mark'])}
          totalCount={7}
          size="card"
        />
      )

      // Everything inside the labelled group is decorative; leaving the count
      // text exposed makes some readers announce "7 speakers" twice.
      for (const node of Array.from(container.querySelectorAll('[role="img"] > *'))) {
        expect(node).toHaveAttribute('aria-hidden', 'true')
      }
      expect(screen.queryByText('7 speakers')).toHaveAttribute('aria-hidden', 'true')
    })

    test('is a single element with no tab stops', () => {
      const { container } = render(
        <SpeakerAvatarGroup speakers={previews(['Kate', 'John'])} totalCount={2} size="card" />
      )

      expect(screen.getAllByRole('img')).toHaveLength(1)
      expect(container.querySelectorAll('button, a, [tabindex]')).toHaveLength(0)
    })

    test('names an unlabelled speaker rather than leaving a gap', () => {
      const { container } = render(
        <SpeakerAvatarGroup
          speakers={[preview({ label: '  ' })]}
          totalCount={1}
          size="card"
        />
      )

      expect(screen.getByRole('img')).toHaveAttribute('aria-label', '1 speaker: Unnamed speaker')
      expect(circles(container)[0]).toHaveTextContent('?')
    })
  })

  // jsdom resolves no container queries, so these assert the contract in classes.
  // The measured behaviour they stand for was verified in the browser: at 390px
  // the header row is 244px wide and the counts alone take 223px, so the group
  // cannot share the line and steps aside instead of adding a second row.
  describe('tight containers', () => {
    test('the header group hides when its container is too narrow for it', () => {
      render(
        <SpeakerAvatarGroup speakers={previews(['Kate'])} totalCount={1} size="header" />
      )
      expect(screen.getByRole('img')).toHaveClass('@max-sm:hidden')
    })

    test('the header count text drops out before the group does', () => {
      render(
        <SpeakerAvatarGroup speakers={previews(['Kate'])} totalCount={1} size="header" />
      )
      // A wider breakpoint than the group's, so text goes first.
      expect(screen.getByText('1 speaker')).toHaveClass('@max-3xl:hidden')
    })

    test('the card group never hides — it owns a row of its own', () => {
      render(<SpeakerAvatarGroup speakers={previews(['Kate'])} totalCount={1} size="card" />)
      const group = screen.getByRole('img')
      expect(group).not.toHaveClass('@max-sm:hidden')
      expect(screen.getByText('1 speaker')).not.toHaveClass('@max-3xl:hidden')
    })
  })

  test('renders a placeholder that is hidden from assistive tech while loading', () => {
    render(<SpeakerAvatarGroup speakers={[]} totalCount={0} size="card" loading />)

    const placeholder = screen.getByTestId('speaker-avatar-group-loading')
    expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
