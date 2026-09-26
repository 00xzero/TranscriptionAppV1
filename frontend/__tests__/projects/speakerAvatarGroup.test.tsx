import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectSpeakerPreview } from '@/contracts/db'
import { SpeakerAvatarGroup } from '@/components/Projects/SpeakerAvatarGroup'
import { SPEAKER_COLORS } from '@/lib/speakers/palette'

const preview = (overrides: Partial<ProjectSpeakerPreview> = {}): ProjectSpeakerPreview => ({
  id: '11111111-1111-1111-1111-111111111111',
  transcriptId: '22222222-2222-2222-2222-222222222222',
  ordinal: 0,
  customLabel: 'Kate',
  paletteIndex: 0,
  ...overrides,
})

const previews = (labels: string[]): ProjectSpeakerPreview[] =>
  labels.map((label, index) =>
    preview({
      id: `speaker-${index}`,
      customLabel: label,
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

  describe('the empty state', () => {
    test('says nobody has spoken yet instead of counting to zero', () => {
      const { container } = render(
        <SpeakerAvatarGroup speakers={[]} totalCount={0} size="card" />
      )

      expect(circles(container)).toHaveLength(0)
      expect(screen.getByText('No speakers yet!')).toBeInTheDocument()
      expect(screen.queryByText('0 speakers')).not.toBeInTheDocument()
    })

    test('the label matches the copy, so the two cannot drift', () => {
      render(<SpeakerAvatarGroup speakers={[]} totalCount={0} size="card" />)
      expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'No speakers yet!')
    })

    test('the ghost leaves with the copy rather than sitting there alone', () => {
      // On the header the count text hides below @3xl. An unexplained ghost
      // floating in the row is worse than showing nothing, so they share a span.
      const { container } = render(
        <SpeakerAvatarGroup speakers={[]} totalCount={0} size="header" />
      )

      const copy = screen.getByText(/No speakers yet!/)
      expect(copy).toHaveClass('@max-3xl:hidden')
      expect(copy).toContainElement(container.querySelector('svg'))
    })

    test('the ghost takes its colour from the text, so both themes are covered', () => {
      const { container } = render(
        <SpeakerAvatarGroup speakers={[]} totalCount={0} size="card" />
      )

      // lucide paints in currentColor; the span is text-muted, which is already
      // defined for light and dark. No per-theme fill to keep in sync.
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(screen.getByText(/No speakers yet!/)).toHaveClass('text-muted')
    })

    test('a real count still reads as a count', () => {
      render(<SpeakerAvatarGroup speakers={previews(['Kate'])} totalCount={1} size="card" />)
      expect(screen.getByText('1 speaker')).toBeInTheDocument()
      expect(screen.queryByText('No speakers yet!')).not.toBeInTheDocument()
    })
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
          speakers={[preview({ customLabel: 'Kate', paletteIndex: 2 })]}
          totalCount={1}
          size="card"
        />
      )

      expect(screen.getByText('K')).toHaveStyle({ backgroundColor: SPEAKER_COLORS[2] })
    })

    test('wraps past the end of the palette', () => {
      render(
        <SpeakerAvatarGroup
          speakers={[preview({ customLabel: 'Kate', paletteIndex: SPEAKER_COLORS.length })]}
          totalCount={1}
          size="card"
        />
      )

      expect(screen.getByText('K')).toHaveStyle({ backgroundColor: SPEAKER_COLORS[0] })
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

    test('names a speaker without a custom label by its ordinal', () => {
      const { container } = render(
        <SpeakerAvatarGroup
          speakers={[preview({ ordinal: 3, customLabel: null })]}
          totalCount={1}
          size="card"
        />
      )

      expect(screen.getByRole('img')).toHaveAttribute('aria-label', '1 speaker: Speaker 3')
      expect(circles(container)[0]).toHaveTextContent('S3')
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

  describe('tooltips', () => {
    // The circles are aria-hidden and never focusable, so hover is the only way
    // in and getByText is the only handle on them.
    const circleFor = (initials: string) => screen.getByText(initials)

    test('names the speaker on hover', async () => {
      const user = userEvent.setup()
      render(
        <SpeakerAvatarGroup
          speakers={previews(['Kate', 'John Smith'])}
          totalCount={2}
          size="card"
        />
      )

      await user.hover(circleFor('JS'))

      await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('John Smith'))
    })

    test('names a generic speaker Speaker {ordinal} on hover', async () => {
      const user = userEvent.setup()
      render(
        <SpeakerAvatarGroup
          speakers={[preview({ ordinal: 0, customLabel: null })]}
          totalCount={1}
          size="card"
        />
      )

      await user.hover(circleFor('S0'))

      await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Speaker 0'))
    })

    test('the overflow badge counts the hidden speakers instead of naming them', async () => {
      const user = userEvent.setup()
      render(
        <SpeakerAvatarGroup
          speakers={previews(['Kate', 'John', 'Sarah', 'Mark'])}
          totalCount={6}
          size="card"
        />
      )

      await user.hover(circleFor('+3'))

      // Mark is in the preview but not on screen; naming him would imply the
      // badge lists the overflow, which the capped preview cannot do.
      await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('3 more speakers'))
      expect(screen.queryByText('Mark')).not.toBeInTheDocument()
    })

    test('the circles sit above the card link, which is what makes them hoverable', () => {
      // RecentProjectCard stretches its title link with `after:inset-0`. A
      // statically positioned row paints below that pseudo-element and never
      // receives the pointer -- the bug the old `title` attribute silently had.
      const { container } = render(
        <SpeakerAvatarGroup speakers={previews(['Kate'])} totalCount={1} size="card" />
      )

      const row = container.querySelector('[role="img"] > div')
      expect(row).toHaveClass('relative', 'z-10')
    })

    test('stays out of the tab order', async () => {
      const user = userEvent.setup()
      render(
        <SpeakerAvatarGroup speakers={previews(['Kate', 'John'])} totalCount={2} size="card" />
      )

      await user.tab()

      // Radix's default trigger is a button; `asChild` onto the plain circle is
      // load-bearing, or every card would gain four tab stops before its menu.
      expect(circleFor('K')).not.toHaveFocus()
      expect(circleFor('J')).not.toHaveFocus()
    })
  })

  describe('chrome', () => {
    test('the overflow badge is the same circle as a speaker, not a smaller one', () => {
      const { container } = render(
        <SpeakerAvatarGroup
          speakers={previews(['Kate', 'John', 'Sarah', 'Mark'])}
          totalCount={9}
          size="card"
        />
      )

      const all = Array.from(circles(container))
      const badge = all[all.length - 1]
      expect(badge).toHaveTextContent('+6')
      // Same sizing classes, so the badge cannot drift from its neighbours.
      for (const size of ['h-7', 'min-w-7', 'text-[10px]']) {
        expect(badge).toHaveClass(size)
        expect(all[0]).toHaveClass(size)
      }
      // It reads smaller when its fill does not clear the card behind it:
      // surface-alt is 1.09:1 on a dark card, which erased the disc.
      expect(badge).not.toHaveClass('bg-surface-alt')
      expect(badge).toHaveClass('bg-border')
    })

    test('the circles are not selectable text', () => {
      const { container } = render(
        <SpeakerAvatarGroup speakers={previews(['Kate', 'John'])} totalCount={5} size="card" />
      )

      // Initials are a picture of a person, not a caption: dragging across them
      // should not select, and the caret should not turn into an I-beam.
      for (const circle of Array.from(circles(container))) {
        expect(circle).toHaveClass('select-none', 'cursor-default')
      }
      // Without an href there is nothing to click, so the arrow is honest.
      expect(container.querySelector('a')).toBeNull()
    })
  })

  describe('the click target', () => {
    test('the row carries the surface link when there is one', () => {
      render(
        <SpeakerAvatarGroup
          speakers={previews(['Kate'])}
          totalCount={1}
          size="card"
          href="/projects/p1"
        />
      )

      // Taking the pointer for hover means taking the click too, so the row
      // has to go where the card goes or it is a hole in a clickable surface.
      const row = screen.getByText('K').closest('a')
      expect(row).toHaveAttribute('href', '/projects/p1')
      expect(row).toHaveAttribute('aria-hidden', 'true')
      expect(row).toHaveAttribute('tabindex', '-1')
    })

    test('the overflow badge navigates with the rest of the row', () => {
      render(
        <SpeakerAvatarGroup
          speakers={previews(['Kate', 'John', 'Sarah', 'Mark'])}
          totalCount={7}
          size="card"
          href="/projects/p1"
        />
      )

      expect(screen.getByText('+4').closest('a')).toHaveAttribute('href', '/projects/p1')
    })

    test('a surface that does not navigate gets no link', () => {
      render(<SpeakerAvatarGroup speakers={previews(['Kate'])} totalCount={1} size="header" />)

      // The project header is not itself a link; inventing one here would put a
      // second route into a card that has none.
      expect(screen.getByText('K').closest('a')).toBeNull()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    test('the cursor matches what the row actually does', () => {
      const { rerender } = render(
        <SpeakerAvatarGroup
          speakers={previews(['Kate'])}
          totalCount={1}
          size="card"
          href="/projects/p1"
        />
      )
      expect(screen.getByText('K')).toHaveClass('cursor-pointer')

      rerender(<SpeakerAvatarGroup speakers={previews(['Kate'])} totalCount={1} size="card" />)
      // No destination, so no hand promising one -- but never a text caret.
      expect(screen.getByText('K')).toHaveClass('cursor-default')
      expect(screen.getByText('K')).toHaveClass('select-none')
    })
  })

  test('renders a placeholder that is hidden from assistive tech while loading', () => {
    render(<SpeakerAvatarGroup speakers={[]} totalCount={0} size="card" loading />)

    const placeholder = screen.getByTestId('speaker-avatar-group-loading')
    expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
