import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectArchivePanel } from '@/components/Projects/ProjectArchivePanel'
import {
  makeProject,
  makeTranscript,
  projectProviderData,
  transcriptProviderData,
} from './fixtures'

const mockUseProjectsData = jest.fn()
const mockUseTranscriptsData = jest.fn()
let mockPathname = '/projects'

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
  useTranscriptsData: () => mockUseTranscriptsData(),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

const projects = [
  makeProject({ id: 'client', name: 'Client Research' }),
  makeProject({ id: 'discovery', name: 'Discovery Calls', parent_id: 'client' }),
  makeProject({ id: 'interviews', name: 'User Interviews', parent_id: 'client' }),
  makeProject({ id: 'deep', name: 'Follow-ups', parent_id: 'interviews' }),
  makeProject({ id: 'podcast', name: 'Podcast Episodes' }),
  makeProject({ id: 'gone', name: 'Gone', deleting_at: '2026-09-14T12:00:00Z' }),
]

const transcripts = [
  makeTranscript({ id: 't1', project_id: 'discovery' }),
  makeTranscript({ id: 't2', project_id: 'discovery' }),
  makeTranscript({ id: 't3', project_id: 'deep' }),
  makeTranscript({ id: 't4', project_id: 'podcast' }),
  makeTranscript({ id: 't5', project_id: null }),
]

function setup(pathname: string, overrides: { projectError?: Error } = {}) {
  mockPathname = pathname
  mockUseProjectsData.mockReturnValue({
    ...projectProviderData(projects),
    projectError: overrides.projectError ?? null,
  })
  mockUseTranscriptsData.mockReturnValue(transcriptProviderData(transcripts))
  return render(<ProjectArchivePanel />)
}

const link = (name: RegExp) => screen.getByRole('link', { name })

describe('ProjectArchivePanel', () => {
  test('shows pinned rows and direct transcript counts, hiding projects being deleted', () => {
    setup('/projects')

    expect(link(/All Transcripts/)).toHaveAttribute('href', '/transcripts')
    expect(within(link(/All Transcripts/)).getByText('5')).toBeInTheDocument()
    expect(link(/Unfiled/)).toHaveAttribute('href', '/projects#unfiled')
    expect(within(link(/Unfiled/)).getByText('1')).toBeInTheDocument()
    // Only direct transcripts count, matching the folder rows.
    expect(within(link(/Client Research/)).getByText('0')).toBeInTheDocument()
    expect(within(link(/Podcast Episodes/)).getByText('1')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Gone/ })).not.toBeInTheDocument()
    // Collapsed by default when nothing is active.
    expect(screen.queryByRole('link', { name: /Discovery Calls/ })).not.toBeInTheDocument()
  })

  test('marks the active project and reveals its ancestors and children', () => {
    setup('/projects/interviews')

    expect(link(/User Interviews/)).toHaveAttribute('aria-current', 'page')
    expect(link(/Discovery Calls/)).not.toHaveAttribute('aria-current')
    expect(link(/Follow-ups/)).toHaveAttribute('href', '/projects/deep')
    expect(screen.getByRole('button', { name: 'Collapse Client Research' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  test('toggles folders open and closed', async () => {
    const user = userEvent.setup()
    setup('/projects')

    await user.click(screen.getByRole('button', { name: 'Expand Client Research' }))
    expect(link(/Discovery Calls/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Collapse Client Research' }))
    expect(screen.queryByRole('link', { name: /Discovery Calls/ })).not.toBeInTheDocument()
  })

  test('search reveals matches with their ancestors and hides pinned rows', async () => {
    const user = userEvent.setup()
    setup('/projects')

    await user.type(screen.getByRole('textbox', { name: 'Search project archive' }), 'follow')

    expect(link(/Client Research/)).toBeInTheDocument()
    expect(link(/User Interviews/)).toBeInTheDocument()
    expect(link(/Follow-ups/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Podcast Episodes/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Unfiled/ })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: 'Search project archive' }))
    await user.type(screen.getByRole('textbox', { name: 'Search project archive' }), 'zzz')
    expect(screen.getByText('No matching projects.')).toBeInTheDocument()
  })

  test('renders nothing when the page is showing a load error', () => {
    const { container } = setup('/projects', { projectError: new Error('boom') })

    expect(container).toBeEmptyDOMElement()
  })
})
