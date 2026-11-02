import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectPage from '@/app/(app)/projects/[projectId]/page'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Tag } from '@/contracts/db'
import {
  addTranscriptTag,
  createTranscriptTag,
  fetchTags,
  fetchTranscriptTags,
  mergeTags,
  renameTag,
} from '@/lib/supabase/queries'
import { TagsProvider } from '@/lib/tags/TagsProvider'
import { makeProject, makeTranscript, projectProviderData, transcriptProviderData } from '../projects/fixtures'

jest.mock('@/lib/auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'app-user-a' }) }))
jest.mock('@/components/ui/toaster', () => ({ toast: jest.fn() }))

const mockUseProjectsData = jest.fn()
const mockUseTranscriptsData = jest.fn()
jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
  useTranscriptsData: () => mockUseTranscriptsData(),
}))
jest.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'current' }),
  useRouter: () => ({ replace: jest.fn() }),
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  useSearchParams: () => jest.requireActual('../helpers/locationSearchParams').useLocationSearchParams(),
}))

const tag = (id: string, name: string, color = '#4F638C'): Tag => ({
  id, user_id: 'u1', name, color, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
})
const INTERVIEW = tag('g1', 'Interview')
const RESEARCH = tag('g2', 'Research', '#7C3AED')
const STANDUP = tag('g3', 'Stand-up', '#C73E1D')
const ELSEWHERE = tag('g4', 'Elsewhere', '#0D9488')

function setUp() {
  const project = makeProject({ id: 'current', name: 'Current' })
  const transcripts = [
    makeTranscript({ id: 't1', project_id: 'current', title: 'Kickoff', updated_at: '2026-10-03T00:00:00Z' }),
    makeTranscript({ id: 't2', project_id: 'current', title: 'Review', updated_at: '2026-10-02T00:00:00Z' }),
    makeTranscript({ id: 't3', project_id: 'current', title: 'Retro', updated_at: '2026-10-01T00:00:00Z' }),
    makeTranscript({ id: 't4', project_id: null, title: 'Unfiled one' }),
  ]
  mockUseProjectsData.mockReturnValue(projectProviderData([project]))
  mockUseTranscriptsData.mockReturnValue(transcriptProviderData(transcripts))
  jest.mocked(fetchTags).mockResolvedValue([INTERVIEW, RESEARCH, STANDUP, ELSEWHERE])
  jest.mocked(fetchTranscriptTags).mockResolvedValue([
    { transcript_id: 't1', tag_id: 'g1' },
    { transcript_id: 't1', tag_id: 'g2' },
    { transcript_id: 't2', tag_id: 'g2' },
    { transcript_id: 't4', tag_id: 'g4' },
  ])
}

function renderPage() {
  return render(
    <TooltipProvider>
      <TagsProvider>
        <ProjectPage />
      </TagsProvider>
    </TooltipProvider>
  )
}

const row = (id: string) => screen.getByTestId(`transcript-row-${id}`)
const filter = () => screen.getByRole('group', { name: 'Tags' })

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState(null, '', '/projects/current')
  setUp()
})

test('rows show their tags as chips', async () => {
  renderPage()
  await waitFor(() => expect(within(row('t1')).getByText('Interview')).toBeInTheDocument())
  expect(within(row('t1')).getByText('Research')).toBeInTheDocument()
  expect(within(row('t2')).getByText('Research')).toBeInTheDocument()
  expect(within(row('t3')).queryByText('Interview')).not.toBeInTheDocument()
})

test('the filter offers the tags this list carries, with counts', async () => {
  renderPage()
  await waitFor(() => expect(filter()).toBeInTheDocument())
  const chips = within(filter()).getAllByRole('button')
  expect(chips.map((chip) => chip.textContent)).toEqual(['All 3', 'Interview1', 'Research2'])
})

test('selecting tags shows transcripts with any of them; Clear filter brings back every one', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(filter()).toBeInTheDocument())

  await user.click(within(filter()).getByRole('button', { name: /^Interview/ }))
  expect(screen.queryByTestId('transcript-row-t2')).not.toBeInTheDocument()
  expect(row('t1')).toBeInTheDocument()

  await user.click(within(filter()).getByRole('button', { name: /^Research/ }))
  expect(row('t2')).toBeInTheDocument()
  expect(screen.queryByTestId('transcript-row-t3')).not.toBeInTheDocument()

  await user.click(within(filter()).getByRole('button', { name: /^All/ }))
  expect(row('t3')).toBeInTheDocument()
})

test('a filter that matches nothing says so and can be cleared', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(filter()).toBeInTheDocument())
  await user.click(within(filter()).getByRole('button', { name: /^Interview/ }))

  // Interview comes off Kickoff from the row's tag box: nothing matches now.
  await user.click(within(row('t1')).getByRole('button', { name: 'More options for Kickoff' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Tags…' }))
  await user.click(await screen.findByRole('button', { name: 'Remove Interview' }))
  await user.keyboard('{Escape}')

  expect(await screen.findByText('No transcripts match.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Clear filter' }))
  expect(row('t3')).toBeInTheDocument()
})

test('Tags… opens the tag box with focus in its search, and choices write at once', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(within(row('t3')).getByRole('button', { name: 'More options for Retro' })).toBeInTheDocument())
  await user.click(within(row('t3')).getByRole('button', { name: 'More options for Retro' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Tags…' }))

  const search = await screen.findByRole('combobox', { name: 'Search or create a tag' })
  await waitFor(() => expect(search).toHaveFocus())
  await user.type(search, 'stand{Enter}')
  expect(addTranscriptTag).toHaveBeenCalledWith('t3', 'g3')
  await waitFor(() => expect(within(row('t3')).getByText('Stand-up')).toBeInTheDocument())

  await user.type(search, 'Planning{Enter}')
  expect(createTranscriptTag).toHaveBeenCalledWith('t3', expect.any(String), 'Planning', expect.any(String))
  await waitFor(() => expect(within(row('t3')).getByText('Planning')).toBeInTheDocument())
})

test('closing the tag box gives focus back to the row’s ⋯ button', async () => {
  const user = userEvent.setup()
  renderPage()
  const more = await within(row('t3')).findByRole('button', { name: 'More options for Retro' })
  await user.click(more)
  await user.click(await screen.findByRole('menuitem', { name: 'Tags…' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Search or create a tag' })).toHaveFocus())
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Search or create a tag' })).not.toBeInTheDocument())
  expect(more).toHaveFocus()
})

test('clicking elsewhere closes the tag box and leaves focus where the click put it', async () => {
  const user = userEvent.setup()
  renderPage()
  const more = await within(row('t3')).findByRole('button', { name: 'More options for Retro' })
  await user.click(more)
  await user.click(await screen.findByRole('menuitem', { name: 'Tags…' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Search or create a tag' })).toHaveFocus())
  const all = within(filter()).getByRole('button', { name: /^All/ })
  await user.click(all)
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Search or create a tag' })).not.toBeInTheDocument())
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(all).toHaveFocus()
})

test('after a failed first load, Retry brings the tag box back and a new tag shows at once', async () => {
  const user = userEvent.setup()
  jest.mocked(fetchTags).mockReset().mockRejectedValueOnce({ code: '', message: 'Failed to fetch' })
    .mockResolvedValue([INTERVIEW, RESEARCH, STANDUP, ELSEWHERE])
  renderPage()
  const more = await within(row('t3')).findByRole('button', { name: 'More options for Retro' })
  await user.click(more)
  await user.click(await screen.findByRole('menuitem', { name: 'Tags…' }))
  expect(await screen.findByText('Couldn’t load your tags.')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Retry' }))
  const search = await screen.findByRole('combobox', { name: 'Search or create a tag' })
  await user.type(search, 'Planning{Enter}')
  await waitFor(() => expect(within(row('t3')).getByText('Planning')).toBeInTheDocument())
})

describe('the selected tag’s menu', () => {
  async function selectOnly(user: ReturnType<typeof userEvent.setup>, name: string) {
    await waitFor(() => expect(filter()).toBeInTheDocument())
    await user.click(within(filter()).getByRole('button', { name: new RegExp(`^${name}`) }))
    await user.click(screen.getByRole('button', { name: `More options for ${name}` }))
  }

  test('renames the tag everywhere', async () => {
    const user = userEvent.setup()
    jest.mocked(renameTag).mockResolvedValue({ ...RESEARCH, name: 'Discovery' })
    renderPage()
    await selectOnly(user, 'Research')
    await user.click(await screen.findByRole('menuitem', { name: 'Rename tag…' }))
    const field = await screen.findByRole('textbox', { name: 'Tag name' })
    await user.clear(field)
    await user.type(field, 'Discovery{Enter}')
    expect(renameTag).toHaveBeenCalledWith('g2', 'Research', 'Discovery')
    await waitFor(() => expect(within(row('t2')).getByText('Discovery')).toBeInTheDocument())
  })

  test('renaming onto another tag’s name asks to merge them', async () => {
    const user = userEvent.setup()
    jest.mocked(mergeTags).mockResolvedValue({ tag: INTERVIEW, merged: true })
    renderPage()
    await selectOnly(user, 'Research')
    await user.click(await screen.findByRole('menuitem', { name: 'Rename tag…' }))
    const field = await screen.findByRole('textbox', { name: 'Tag name' })
    await user.clear(field)
    await user.type(field, 'interview')
    expect(screen.getByText(/“Interview” already exists/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Merge…' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Merge Research into Interview?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }))
    expect(renameTag).not.toHaveBeenCalled()
    expect(mergeTags).toHaveBeenCalledWith('g2', 'g1')
    await waitFor(() => expect(within(row('t2')).getByText('Interview')).toBeInTheDocument())
    expect(within(row('t1')).getAllByText('Interview')).toHaveLength(1)
  })

  test('closing the colour picker gives focus back to the tag’s ⋯ button', async () => {
    const user = userEvent.setup()
    renderPage()
    await selectOnly(user, 'Research')
    await user.click(await screen.findByRole('menuitem', { name: 'Change colour…' }))
    await screen.findByRole('radiogroup', { name: 'Colour' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Colour' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'More options for Research' })).toHaveFocus()
  })
})
