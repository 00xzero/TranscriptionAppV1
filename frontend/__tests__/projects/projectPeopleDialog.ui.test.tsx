import React, { useRef, useState } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectPeopleDialog } from '@/components/Projects/ProjectPeopleDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { PersonAppearance, ProjectPeople, ProjectPerson } from '@/contracts/db'
import { buildProjectTree } from '@/core/projects/tree'
import { fetchPersonAppearances, fetchProjectPeople } from '@/lib/supabase/queries'
import { makeProject } from './fixtures'

const mockFetchPeople = fetchProjectPeople as jest.MockedFunction<typeof fetchProjectPeople>
const mockFetchAppearances = fetchPersonAppearances as jest.MockedFunction<typeof fetchPersonAppearances>

const root = makeProject({ id: 'root', name: 'Dechra' })
const child = makeProject({ id: 'child', name: 'Morning Alignment', parent_id: 'root' })
const elsewhere = makeProject({ id: 'elsewhere', name: 'Elsewhere' })
const tree = buildProjectTree([root, child, elsewhere])

const person = (overrides: Partial<ProjectPerson> & { id: string; name: string }): ProjectPerson => ({
  preferred_color: '#4F638C', organisation_name: null, hidden: false,
  transcript_count: 1, talk_ms: 60_000, last_seen_at: '2026-10-12T00:00:00Z', ...overrides,
})

const alice = person({ id: 'alice', name: 'Alice', organisation_name: 'Halden', transcript_count: 3, talk_ms: 600_000 })
const bob = person({ id: 'bob', name: 'Bob', organisation_name: 'Client team', transcript_count: 1 })

const answer = (people: ProjectPerson[] = [alice, bob]): ProjectPeople => ({
  people,
  voices: [{
    transcript_id: 't-voices', title: 'Morning sync', project_id: 'child', created_at: '2026-10-14T00:00:00Z',
    voice_ids: ['v3'],
    peers: [
      { id: 'a1', ordinal: 2, customLabel: null, personId: 'alice', personName: 'Alice', organisationName: null },
      { id: 'v3', ordinal: 3, customLabel: null, personId: null, personName: null, organisationName: null },
    ],
  }],
})

const appearance = (id: string, projectId: string | null, title: string): PersonAppearance => ({
  transcript_id: id, title, project_id: projectId, created_at: '2026-10-12T00:00:00Z',
  talk_ms: 120_000, transcript_talk_ms: 480_000,
})

const branchTranscripts = [{ project_id: 'root' }, { project_id: 'root' }, { project_id: 'child' }]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** The page's part: the header button, and the dialog mounted only while open. */
function Harness({ onLoaded = jest.fn() }: { onLoaded?: (total: number) => void }) {
  const [open, setOpen] = useState(true)
  const pill = useRef<HTMLButtonElement>(null)
  return (
    <TooltipProvider>
      <button ref={pill} type="button" onClick={() => setOpen(true)}>Speakers</button>
      {open && (
        <ProjectPeopleDialog
          project={root}
          tree={tree}
          branchTranscripts={branchTranscripts}
          returnFocusRef={pill}
          onClose={() => setOpen(false)}
          onLoaded={onLoaded}
        />
      )}
    </TooltipProvider>
  )
}

describe('ProjectPeopleDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchPeople.mockResolvedValue(answer())
    mockFetchAppearances.mockResolvedValue([])
  })

  test('lists the people in the order given, with their figures and the counts line', async () => {
    const onLoaded = jest.fn()
    render(<Harness onLoaded={onLoaded} />)

    const dialog = await screen.findByRole('dialog', { name: 'People in Dechra' })
    const rows = await within(dialog).findAllByTestId(/^person-row-/)
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Alice'),
      expect.stringContaining('Bob'),
    ])
    expect(rows[0]).toHaveTextContent('Halden')
    expect(rows[0]).toHaveTextContent('3 transcripts')
    expect(rows[0]).toHaveTextContent('10 mins speaking')
    expect(dialog).toHaveTextContent('2 people · 3 transcripts, 1 of them in sub-projects')
    // Two people plus one unnamed voice: the header's count.
    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(onLoaded).toHaveBeenCalledWith(3)
  })

  test('shows a filter only once the list is long, matching name or organisation', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 9 }, (_, index) =>
      person({ id: `p${index}`, name: `Person ${index}`, organisation_name: index === 4 ? 'Northgate' : null }))
    mockFetchPeople.mockResolvedValue(answer(many))
    render(<Harness />)

    const filter = await screen.findByRole('textbox', { name: 'Filter people' })
    await user.type(filter, 'northgate')
    expect(screen.getAllByTestId(/^person-row-/)).toHaveLength(1)
    expect(screen.getByTestId('person-row-p4')).toBeInTheDocument()

    await user.clear(filter)
    await user.type(filter, 'zebra')
    expect(screen.getByText('No one here matches “zebra”.')).toBeInTheDocument()
  })

  test('has no filter for a short list', async () => {
    render(<Harness />)
    await screen.findByTestId('person-row-alice')
    expect(screen.queryByRole('textbox', { name: 'Filter people' })).not.toBeInTheDocument()
  })

  test('choosing a person slides to their transcripts in this folder, focused on Back', async () => {
    const user = userEvent.setup()
    mockFetchAppearances.mockResolvedValue([
      appearance('t-root', 'root', 'Risk assessment'),
      appearance('t-child', 'child', 'Morning alignment 14.10'),
      appearance('t-outside', 'elsewhere', 'Somewhere else'),
    ])
    render(<Harness />)

    await user.click(await screen.findByTestId('person-row-alice'))

    const back = screen.getByRole('button', { name: 'People in Dechra' })
    await waitFor(() => expect(back).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in People/ })).toHaveAttribute('href', '/people/alice')
    expect(mockFetchAppearances).toHaveBeenCalledWith('alice')

    // Only transcripts inside the folder; a nested one names its sub-project.
    expect(await screen.findByTestId('appearance-t-root')).toBeInTheDocument()
    expect(screen.queryByTestId('appearance-t-outside')).not.toBeInTheDocument()
    expect(screen.getByTestId('appearance-t-child')).toHaveTextContent('Morning Alignment ·')
    expect(screen.getByTestId('appearance-t-root')).not.toHaveTextContent('Dechra ·')
    expect(screen.getByTestId('appearance-t-root')).toHaveTextContent('2 mins · 25% of the talking')
    expect(screen.getByRole('link', { name: /^Risk assessment/ })).toHaveAttribute('href', '/editor/t-root')
    // The summary counts the rows shown: the two in the folder, not the one outside.
    expect(screen.getByText(/^2 transcripts in Dechra · 4 mins speaking · last heard /)).toBeInTheDocument()
    // Named and described by the person while their screen shows.
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/2 transcripts in Dechra/)
    // Looking only: no remove button.
    expect(screen.queryByRole('button', { name: /Remove Alice/ })).not.toBeInTheDocument()
  })

  test('the summary follows the rows it sits above, even when the people list read differently', async () => {
    const user = userEvent.setup()
    // The list says three transcripts and ten minutes; by the time the person
    // opens, only one transcript of two minutes is left.
    const rowsLoad = deferred<PersonAppearance[]>()
    mockFetchAppearances.mockReturnValueOnce(rowsLoad.promise)
    render(<Harness />)

    expect(await screen.findByTestId('person-row-alice')).toHaveTextContent('3 transcripts')
    await user.click(screen.getByTestId('person-row-alice'))

    // Nothing to sum yet: the line holds its place empty rather than guessing.
    expect(screen.queryByText(/in Dechra ·/)).not.toBeInTheDocument()

    await act(async () => rowsLoad.resolve([appearance('t-root', 'root', 'Risk assessment')]))

    expect(screen.getByText(/^1 transcript in Dechra · 2 mins speaking · last heard /)).toBeInTheDocument()
    expect(screen.queryByText(/3 transcripts in Dechra/)).not.toBeInTheDocument()
  })

  test('says so when the person is no longer in any transcript in the folder', async () => {
    const user = userEvent.setup()
    mockFetchAppearances.mockResolvedValueOnce([appearance('t-outside', 'elsewhere', 'Somewhere else')])
    render(<Harness />)

    await user.click(await screen.findByTestId('person-row-alice'))

    expect(await screen.findByText('Not in any transcript in Dechra')).toBeInTheDocument()
    expect(screen.getByText(/^Alice isn.t in any transcript in Dechra any more\.$/)).toBeInTheDocument()
  })

  test('Back returns to the list with focus on the person who was open', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(await screen.findByTestId('person-row-bob'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'People in Dechra' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'People in Dechra' }))

    await waitFor(() => expect(screen.getByTestId('person-row-bob')).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'People in Dechra' })).toBeInTheDocument()
  })

  test('the left arrow goes back on the person screen, but never from the filter', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 9 }, (_, index) => person({ id: `p${index}`, name: `Person ${index}` }))
    mockFetchPeople.mockResolvedValue(answer(many))
    render(<Harness />)

    const filter = await screen.findByRole('textbox', { name: 'Filter people' })
    await user.type(filter, 'Per{ArrowLeft}x')
    expect(filter).toHaveValue('Pexr')

    await user.clear(filter)
    await user.click(screen.getByTestId('person-row-p2'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'People in Dechra' })).toHaveFocus())
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.getByTestId('person-row-p2')).toHaveFocus())
  })

  test('Escape closes and puts focus back on the header button', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByTestId('person-row-alice')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Speakers' })).toHaveFocus()
  })

  test('unnamed voices stay folded until opened, each row opening its transcript', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const toggle = await screen.findByRole('button', { name: /1 unnamed voice/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: /Morning sync/ })).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const row = screen.getByRole('link', { name: /Morning sync/ })
    expect(row).toHaveAttribute('href', '/editor/t-voices')
    expect(row).toHaveTextContent('Morning Alignment ·')
    expect(row).toHaveTextContent('Speaker 3')
  })

  test("switching people never shows the last person's transcripts, even when the next load fails", async () => {
    const user = userEvent.setup()
    mockFetchAppearances.mockResolvedValueOnce([appearance('t-alice', 'root', 'Alice only')])
    render(<Harness />)

    await user.click(await screen.findByTestId('person-row-alice'))
    expect(await screen.findByTestId('appearance-t-alice')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'People in Dechra' }))

    const bobs = deferred<PersonAppearance[]>()
    mockFetchAppearances.mockReturnValueOnce(bobs.promise)
    await user.click(screen.getByTestId('person-row-bob'))

    expect(screen.getByRole('dialog', { name: 'Bob' })).toBeInTheDocument()
    expect(screen.queryByTestId('appearance-t-alice')).not.toBeInTheDocument()

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => bobs.reject(new Error('offline')))
    spy.mockRestore()

    expect(screen.getByText(/Couldn.t load the transcripts/)).toBeInTheDocument()
    expect(screen.queryByTestId('appearance-t-alice')).not.toBeInTheDocument()
    // No summary from Alice's rows, and none made up for Bob's.
    expect(screen.queryByText(/in Dechra ·/)).not.toBeInTheDocument()
  })

  test('says when the people cannot load, and tries again', async () => {
    const user = userEvent.setup()
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchPeople.mockRejectedValueOnce(new Error('offline'))
    const onLoaded = jest.fn()
    render(<Harness onLoaded={onLoaded} />)

    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    spy.mockRestore()

    expect(await screen.findByTestId('person-row-alice')).toBeInTheDocument()
    expect(onLoaded).toHaveBeenCalledTimes(1)
  })
})
