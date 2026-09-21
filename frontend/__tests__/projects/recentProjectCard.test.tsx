import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecentProjectCard } from '@/components/Projects/RecentProjectCard'
import type { ProjectSpeakerSummary } from '@/contracts/db'
import { makeProject } from './fixtures'

const PROJECT_ID = 'project-a'
const HREF = `/projects/${PROJECT_ID}`

const summary: ProjectSpeakerSummary = {
  project_id: PROJECT_ID,
  speaker_count: 2,
  preview: [
    { id: 's1', transcriptId: 't1', label: 'Kate Bishop', color: null, paletteIndex: 0 },
    { id: 's2', transcriptId: 't1', label: 'John Smith', color: null, paletteIndex: 1 },
  ],
}

// `null` means "no summary at all"; an explicit undefined would still pick up
// the default parameter and quietly render the populated card.
const renderCard = (speakerSummary: ProjectSpeakerSummary | null = summary) =>
  render(
    <RecentProjectCard
      project={makeProject({ id: PROJECT_ID, name: 'Project A' })}
      parentPath={null}
      lastActivityAt="2026-09-01T12:00:00Z"
      transcriptCount={2}
      nestedProjectCount={0}
      countsAreBranchTotals
      speakerSummary={speakerSummary ?? undefined}
      speakersLoading={false}
    />
  )

describe('RecentProjectCard', () => {
  describe('the speaker row is not a dead patch in the card', () => {
    // The row has to sit above the title link's stretched ::after or its
    // tooltips never open, and that means it also intercepts the click. If it
    // did not navigate, the middle of a clickable card would silently do
    // nothing -- worst of all on touch, which gets no tooltip in exchange.
    test.each([['KB'], ['JS']])('clicking the %s avatar opens the project', async (initials) => {
      const user = userEvent.setup()
      renderCard()

      const circle = screen.getByText(initials)
      await user.click(circle)

      expect(circle.closest('a')).toHaveAttribute('href', HREF)
    })

    test('the avatar row is a real anchor, so cmd-click and middle-click still work', () => {
      renderCard()

      // An onClick handler would navigate but silently drop opening in a new
      // tab, and "copy link address" with it.
      const row = screen.getByText('KB').closest('a')
      expect(row?.tagName).toBe('A')
      expect(row).toHaveAttribute('href', HREF)
    })

    test('the duplicate link is hidden from keyboard and screen readers', async () => {
      const user = userEvent.setup()
      renderCard()

      const row = screen.getByText('KB').closest('a')
      expect(row).toHaveAttribute('aria-hidden', 'true')
      expect(row).toHaveAttribute('tabindex', '-1')

      // The title link is the one and only announced way in, and it should
      // still be the first thing Tab reaches on the card.
      await user.tab()
      expect(screen.getByRole('link', { name: 'Project A' })).toHaveFocus()
    })

    test('the title link still stretches over the rest of the card', () => {
      renderCard()

      // Raising the avatar row must not shrink the card's own hit area.
      expect(screen.getByRole('link', { name: 'Project A' })).toHaveClass(
        'after:absolute',
        'after:inset-0'
      )
    })

    test('the cursor promises a click the row can keep', () => {
      renderCard()
      expect(screen.getByText('KB')).toHaveClass('cursor-pointer')
    })
  })

  test('a card with no speaker summary renders nothing in that row', () => {
    renderCard(null)
    expect(screen.queryByTestId('speaker-avatar-group')).not.toBeInTheDocument()
  })
})
