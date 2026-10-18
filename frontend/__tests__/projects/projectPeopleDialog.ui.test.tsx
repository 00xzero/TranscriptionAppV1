import React, { useRef } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectPeopleDialog } from '@/components/Projects/ProjectPeopleDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { PersonAppearance, ProjectPeople, ProjectPerson } from '@/contracts/db'
import { buildProjectTree } from '@/core/projects/tree'
import { usePeopleDialogRoute } from '@/lib/projects/usePeopleDialogRoute'
import { fetchPersonAppearances, fetchProjectPeople } from '@/lib/supabase/queries'
import { nextPopState } from '../helpers/locationSearchParams'
import { makeProject } from './fixtures'

jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useSearchParams: () => jest.requireActual('../helpers/locationSearchParams').useLocationSearchParams(),
}))

const mockFetchPeople = fetchProjectPeople as jest.MockedFunction<typeof fetchProjectPeople>
const mockFetchAppearances = fetchPersonAppearances as jest.MockedFunction<typeof fetchPersonAppearances>

// The address only names real ids, so the people here have them.
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOBODY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const numbered = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

const root = makeProject({ id: 'root', name: 'Dechra' })
const child = makeProject({ id: 'child', name: 'Morning Alignment', parent_id: 'root' })
const elsewhere = makeProject({ id: 'elsewhere', name: 'Elsewhere' })
const tree = buildProjectTree([root, child, elsewhere])

const person = (overrides: Partial<ProjectPerson> & { id: string; name: string }): ProjectPerson => ({
  preferred_color: '#4F638C', organisation_name: null, hidden: false,
  transcript_count: 1, talk_ms: 60_000, last_seen_at: '2026-10-12T00:00:00Z', ...overrides,
})

const alice = person({ id: ALICE, name: 'Alice', organisation_name: 'Halden', transcript_count: 3, talk_ms: 600_000 })
const bob = person({ id: BOB, name: 'Bob', organisation_name: 'Client team', transcript_count: 1 })

const answer = (people: ProjectPerson[] = [alice, bob]): ProjectPeople => ({
  people,
  voices: [{
    transcript_id: 't-voices', title: 'Morning sync', project_id: 'child', created_at: '2026-10-14T00:00:00Z',
    voice_ids: ['v3'],
    peers: [
      { id: 'a1', ordinal: 2, customLabel: null, personId: ALICE, personName: 'Alice', organisationName: null },
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

/** The page's part: the header button, and the dialog mounted while the address has it open. */
function Harness({ onLoaded = jest.fn() }: { onLoaded?: (total: number) => void }) {
  const route = usePeopleDialogRoute()
  const pill = useRef<HTMLButtonElement>(null)
  return (
    <TooltipProvider>
      <button ref={pill} type="button" onClick={route.open}>Speakers</button>
      {route.screen.kind !== 'closed' && (
        <ProjectPeopleDialog
          key="root"
          project={root}
          tree={tree}
          branchTranscripts={branchTranscripts}
          returnFocusRef={pill}
          onLoaded={onLoaded}
          route={route}
        />
      )}
    </TooltipProvider>
  )
}

/** Puts the page at an address, as arriving there would, with optional history data of ours. */
function arriveAt(search: string, state: unknown = null) {
  window.history.replaceState(state, '', `/projects/root${search}`)
}

function savedViews(): Record<string, { query: string; voicesOpen: boolean; listScroll: number; personScroll: number }> {
  return JSON.parse(sessionStorage.getItem('project-people-views') ?? '{"views":{}}').views
}

function currentEntry(): string {
  return (window.history.state as { projectPeople: { entry: string } }).projectPeople.entry
}

describe('ProjectPeopleDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchPeople.mockResolvedValue(answer())
    mockFetchAppearances.mockResolvedValue([])
    sessionStorage.clear()
    // Most tests start with the dialog open on its list, as an address would have it.
    arriveAt('?people')
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
      person({ id: numbered(index), name: `Person ${index}`, organisation_name: index === 4 ? 'Northgate' : null }))
    mockFetchPeople.mockResolvedValue(answer(many))
    render(<Harness />)

    const filter = await screen.findByRole('textbox', { name: 'Filter people' })
    await user.type(filter, 'northgate')
    expect(screen.getAllByTestId(/^person-row-/)).toHaveLength(1)
    expect(screen.getByTestId(`person-row-${numbered(4)}`)).toBeInTheDocument()

    await user.clear(filter)
    await user.type(filter, 'zebra')
    expect(screen.getByText('No one here matches “zebra”.')).toBeInTheDocument()
  })

  test('has no filter for a short list', async () => {
    render(<Harness />)
    await screen.findByTestId(`person-row-${ALICE}`)
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

    await user.click(await screen.findByTestId(`person-row-${ALICE}`))

    const back = screen.getByRole('button', { name: 'People in Dechra' })
    await waitFor(() => expect(back).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in People/ })).toHaveAttribute('href', `/people/${ALICE}`)
    expect(mockFetchAppearances).toHaveBeenCalledWith(ALICE)

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

    expect(await screen.findByTestId(`person-row-${ALICE}`)).toHaveTextContent('3 transcripts')
    await user.click(screen.getByTestId(`person-row-${ALICE}`))

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

    await user.click(await screen.findByTestId(`person-row-${ALICE}`))

    expect(await screen.findByText('Not in any transcript in Dechra')).toBeInTheDocument()
    expect(screen.getByText(/^Alice isn.t in any transcript in Dechra any more\.$/)).toBeInTheDocument()
  })

  test('each screen brings its own close button to the same corner, one reachable at a time', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const onList = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' })

    await user.click(await screen.findByTestId(`person-row-${ALICE}`))

    const onPerson = within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })
    expect(onPerson).not.toBe(onList)
    expect(onPerson.className).toBe(onList.className)
    // The list's button left with its screen: out of reach, not removed.
    expect(onList.closest('[inert]')).not.toBeNull()
    expect(onPerson.closest('[inert]')).toBeNull()
  })

  test('the person screen stays drawn while it slides away', async () => {
    const user = userEvent.setup()
    mockFetchAppearances.mockResolvedValue([appearance('t-root', 'root', 'Risk assessment')])
    render(<Harness />)
    await user.click(await screen.findByTestId(`person-row-${ALICE}`))
    expect(await screen.findByTestId('appearance-t-root')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'People in Dechra' }))

    // Back on the list, but Alice's screen is still there, out of reach, so the
    // slide shows it leaving rather than an empty pane.
    expect(await screen.findByRole('dialog', { name: 'People in Dechra' })).toBeInTheDocument()
    expect(screen.getByTestId('appearance-t-root').closest('[inert]')).not.toBeNull()
  })

  test('Back returns to the list with focus on the person who was open', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(await screen.findByTestId(`person-row-${BOB}`))
    await waitFor(() => expect(screen.getByRole('button', { name: 'People in Dechra' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'People in Dechra' }))

    await waitFor(() => expect(screen.getByTestId(`person-row-${BOB}`)).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'People in Dechra' })).toBeInTheDocument()
  })

  test('going back never pulls focus out of a filter the user has already clicked into', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 9 }, (_, index) => person({ id: numbered(index), name: `Person ${index}` }))
    mockFetchPeople.mockResolvedValue(answer(many))
    render(<Harness />)
    await user.click(await screen.findByTestId(`person-row-${numbered(2)}`))
    await waitFor(() => expect(screen.getByRole('button', { name: 'People in Dechra' })).toHaveFocus())

    // Hold the frame in which focus would go back to the row.
    const frames: FrameRequestCallback[] = []
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const popped = nextPopState()
    await user.click(screen.getByRole('button', { name: 'People in Dechra' }))
    await act(() => popped)
    await waitFor(() => expect(frames.length).toBeGreaterThan(0))

    // Within that frame the user clicks into the filter.
    const filter = screen.getByRole('textbox', { name: 'Filter people' })
    act(() => filter.focus())
    act(() => frames.splice(0).forEach((callback) => callback(0)))
    raf.mockRestore()

    expect(filter).toHaveFocus()
  })

  test('the left arrow goes back on the person screen, but never from the filter', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 9 }, (_, index) => person({ id: numbered(index), name: `Person ${index}` }))
    mockFetchPeople.mockResolvedValue(answer(many))
    render(<Harness />)

    const filter = await screen.findByRole('textbox', { name: 'Filter people' })
    await user.type(filter, 'Per{ArrowLeft}x')
    expect(filter).toHaveValue('Pexr')

    await user.clear(filter)
    await user.click(screen.getByTestId(`person-row-${numbered(2)}`))
    await waitFor(() => expect(screen.getByRole('button', { name: 'People in Dechra' })).toHaveFocus())
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.getByTestId(`person-row-${numbered(2)}`)).toHaveFocus())
  })

  test('Escape closes and puts focus back on the header button', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByTestId(`person-row-${ALICE}`)

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

    await user.click(await screen.findByTestId(`person-row-${ALICE}`))
    expect(await screen.findByTestId('appearance-t-alice')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'People in Dechra' }))
    await screen.findByRole('dialog', { name: 'People in Dechra' })

    const bobs = deferred<PersonAppearance[]>()
    mockFetchAppearances.mockReturnValueOnce(bobs.promise)
    await user.click(screen.getByTestId(`person-row-${BOB}`))

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

    expect(await screen.findByTestId(`person-row-${ALICE}`)).toBeInTheDocument()
    expect(onLoaded).toHaveBeenCalledTimes(1)
  })

  test('a project with nobody in it says so rather than showing an empty box', async () => {
    mockFetchPeople.mockResolvedValue({ people: [], voices: [] })
    render(<Harness />)

    const dialog = await screen.findByRole('dialog', { name: 'People in Dechra' })
    expect(await within(dialog).findByRole('heading', { name: 'Nobody here yet' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('0 people · 3 transcripts')
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
  })

  describe('held in the address and the history', () => {
    test('the header opens it fresh, as one step Back can undo', async () => {
      const user = userEvent.setup()
      arriveAt('')
      render(<Harness />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Speakers' }))

      const dialog = await screen.findByRole('dialog', { name: 'People in Dechra' })
      expect(window.location.search).toBe('?people')
      expect(window.history.state.projectPeople).toMatchObject({ depth: 1, rooted: true })
      // A click gets the entrance; only an arrival by address skips it.
      expect(dialog).not.toHaveClass('data-[state=open]:animate-none')

      const popped = nextPopState()
      await user.keyboard('{Escape}')
      await act(() => popped)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(window.location.search).toBe('')
    })

    test('choosing a person is a step of its own, which Back and Forward follow', async () => {
      const user = userEvent.setup()
      arriveAt('')
      render(<Harness />)
      await user.click(screen.getByRole('button', { name: 'Speakers' }))
      await user.click(await screen.findByTestId(`person-row-${ALICE}`))

      expect(window.location.search).toBe(`?people=${ALICE}`)
      expect(window.history.state.projectPeople).toMatchObject({ depth: 2, rooted: true, pushed: true })

      let popped = nextPopState()
      act(() => window.history.back())
      await act(() => popped)
      expect(await screen.findByRole('dialog', { name: 'People in Dechra' })).toBeInTheDocument()

      popped = nextPopState()
      act(() => window.history.forward())
      await act(() => popped)
      expect(await screen.findByRole('dialog', { name: 'Alice' })).toBeInTheDocument()
    })

    test('the history calls carry only our own data, never the router fields', async () => {
      const user = userEvent.setup()
      const push = jest.spyOn(window.history, 'pushState')
      arriveAt('')
      render(<Harness />)
      await user.click(screen.getByRole('button', { name: 'Speakers' }))
      await user.click(await screen.findByTestId(`person-row-${ALICE}`))

      expect(push).toHaveBeenCalledTimes(2)
      for (const [state] of push.mock.calls) expect(Object.keys(state as object)).toEqual(['projectPeople'])
      push.mockRestore()
    })

    test('arriving on a person lands on their screen, already open, focused on Back', async () => {
      arriveAt(`?people=${ALICE}`)
      const { container } = render(<Harness />)

      // On the person from the first frame: no slide over from the list.
      const dialog = screen.getByRole('dialog')
      expect(dialog.querySelector('.w-\\[200\\%\\]')).toHaveClass('-translate-x-1/2')
      expect(dialog).toHaveClass('data-[state=open]:animate-none')
      expect(container.ownerDocument.querySelector('[data-slot=dialog-overlay]')).toHaveClass('data-[state=open]:animate-none')

      expect(await screen.findByRole('dialog', { name: 'Alice' })).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: 'People in Dechra' })).toHaveFocus())
    })

    test('an address naming someone no longer here shows the list once the people have loaded', async () => {
      arriveAt(`?people=${NOBODY}`)
      render(<Harness />)

      await waitFor(() => expect(window.location.search).toBe('?people'))
      expect(screen.getByRole('dialog', { name: 'People in Dechra' })).toBeInTheDocument()
      expect(screen.getByTestId(`person-row-${ALICE}`).closest('[inert]')).toBeNull()
    })

    test('a failed load keeps the person in the address and offers to try again', async () => {
      const user = userEvent.setup()
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockFetchPeople.mockRejectedValueOnce(new Error('offline'))
      arriveAt(`?people=${ALICE}`)
      render(<Harness />)

      const retry = await screen.findByText(/Couldn.t load this person/)
      expect(window.location.search).toBe(`?people=${ALICE}`)

      await user.click(within(retry).getByRole('button', { name: 'Try again' }))
      spy.mockRestore()

      expect(await screen.findByRole('dialog', { name: 'Alice' })).toBeInTheDocument()
      expect(window.location.search).toBe(`?people=${ALICE}`)
    })
  })

  describe('coming back as it was left', () => {
    const many = () => [alice, ...Array.from({ length: 8 }, (_, index) => person({ id: numbered(index), name: `Person ${index}` }))]
    const seed = (entry: string, view: object) => sessionStorage.setItem(
      'project-people-views', JSON.stringify({ order: [entry], views: { [entry]: view } }))

    test('restores the filter, the unnamed voices and both scroll positions', async () => {
      mockFetchPeople.mockResolvedValue(answer(many()))
      mockFetchAppearances.mockResolvedValue([appearance('t-root', 'root', 'Risk assessment')])
      seed('e1', { query: 'Per', voicesOpen: true, listScroll: 120, personScroll: 80 })
      arriveAt(`?people=${ALICE}`, { projectPeople: { entry: 'e1', pushed: true, depth: 2, rooted: true } })
      const { baseElement } = render(<Harness />)

      expect(await screen.findByTestId('appearance-t-root')).toBeInTheDocument()
      const [listBody, personBody] = baseElement.querySelectorAll<HTMLElement>('[role=dialog] .overflow-y-auto')
      await waitFor(() => expect(personBody.scrollTop).toBe(80))
      // The list behind her, out of reach until Back, is as it was too.
      expect(baseElement.querySelector<HTMLInputElement>('input[aria-label="Filter people"]')).toHaveValue('Per')
      expect(baseElement.querySelector('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
      expect(listBody.scrollTop).toBe(120)
    })

    test('a restored filter stays clearable when the list has since grown short', async () => {
      const user = userEvent.setup()
      // Saved while the list was long enough for a filter; two people now.
      seed('e1', { query: 'Ali', voicesOpen: false, listScroll: 0, personScroll: 0 })
      arriveAt('?people', { projectPeople: { entry: 'e1', pushed: false, depth: 1, rooted: true } })
      render(<Harness />)

      const filter = await screen.findByRole('textbox', { name: 'Filter people' })
      expect(filter).toHaveValue('Ali')
      expect(screen.queryByTestId(`person-row-${BOB}`)).not.toBeInTheDocument()

      await user.clear(filter)

      expect(screen.getByTestId(`person-row-${BOB}`)).toBeInTheDocument()
    })

    test('opening from the header ignores what was saved before', async () => {
      const user = userEvent.setup()
      mockFetchPeople.mockResolvedValue(answer(many()))
      seed('e1', { query: 'Per', voicesOpen: true, listScroll: 120, personScroll: 0 })
      arriveAt('', { projectPeople: { entry: 'e1', pushed: false, depth: 1, rooted: true } })
      render(<Harness />)

      await user.click(screen.getByRole('button', { name: 'Speakers' }))

      expect(await screen.findByRole('textbox', { name: 'Filter people' })).toHaveValue('')
      expect(screen.getByRole('button', { name: /1 unnamed voice/ })).toHaveAttribute('aria-expanded', 'false')
    })

    test('choosing a person carries the list as it is into her step', async () => {
      const user = userEvent.setup()
      mockFetchPeople.mockResolvedValue(answer(many()))
      render(<Harness />)
      await user.type(await screen.findByRole('textbox', { name: 'Filter people' }), 'Ali')
      await user.click(screen.getByRole('button', { name: /1 unnamed voice/ }))

      await user.click(screen.getByTestId(`person-row-${ALICE}`))

      expect(savedViews()[currentEntry()]).toEqual({ query: 'Ali', voicesOpen: true, listScroll: 0, personScroll: 0 })
    })

    test('a Back straight after scrolling still saves the step being left, under its own id', async () => {
      const user = userEvent.setup()
      mockFetchAppearances.mockResolvedValue([appearance('t-root', 'root', 'Risk assessment')])
      arriveAt('')
      const { baseElement } = render(<Harness />)
      await user.click(screen.getByRole('button', { name: 'Speakers' }))
      await user.click(await screen.findByTestId(`person-row-${ALICE}`))
      await screen.findByTestId('appearance-t-root')
      const aliceEntry = currentEntry()

      const personBody = baseElement.querySelectorAll<HTMLElement>('[role=dialog] .overflow-y-auto')[1]
      personBody.scrollTop = 60
      personBody.dispatchEvent(new Event('scroll'))
      // Well inside the pause before scrolling is saved on its own.
      const popped = nextPopState()
      act(() => window.history.back())
      await act(() => popped)

      expect(currentEntry()).not.toBe(aliceEntry)
      expect(savedViews()[aliceEntry]?.personScroll).toBe(60)
    })

    test('Forward shows the step as it was saved, not as the list was later changed', async () => {
      const user = userEvent.setup()
      mockFetchPeople.mockResolvedValue(answer(many()))
      arriveAt('')
      const { baseElement } = render(<Harness />)
      await user.click(screen.getByRole('button', { name: 'Speakers' }))
      const filter = await screen.findByRole('textbox', { name: 'Filter people' })
      await user.type(filter, 'Ali')
      await user.click(screen.getByTestId(`person-row-${ALICE}`))
      const aliceEntry = currentEntry()

      let popped = nextPopState()
      act(() => window.history.back())
      await act(() => popped)
      await user.clear(await screen.findByRole('textbox', { name: 'Filter people' }))
      await user.type(screen.getByRole('textbox', { name: 'Filter people' }), 'Person')

      popped = nextPopState()
      act(() => window.history.forward())
      await act(() => popped)

      // The list behind Alice is hers again, and stays so in what is saved.
      expect(await screen.findByRole('dialog', { name: 'Alice' })).toBeInTheDocument()
      expect(baseElement.querySelector('input[aria-label="Filter people"]')).toHaveValue('Ali')
      popped = nextPopState()
      act(() => window.history.back())
      await act(() => popped)
      expect(savedViews()[aliceEntry]?.query).toBe('Ali')
      // And the list's own step is as it was left: filtered by Person.
      expect(screen.getByRole('textbox', { name: 'Filter people' })).toHaveValue('Person')
    })

    test('keeps each step its own view when the page re-renders before Back is heard, as the router does', async () => {
      const user = userEvent.setup()
      // In a browser the router's popstate listener comes first and React
      // renders its update synchronously, so the page's effects can run before
      // the dialog's own listener hears the event. Stand in for it here.
      let renderNow: (() => void) | null = null
      const routerFirst = () => renderNow?.()
      window.addEventListener('popstate', routerFirst)
      arriveAt('')
      const view = render(<Harness />)
      renderNow = () => act(() => view.rerender(<Harness />))

      await user.click(screen.getByRole('button', { name: 'Speakers' }))
      await user.click(await screen.findByRole('button', { name: /1 unnamed voice/ }))
      await user.click(screen.getByTestId(`person-row-${ALICE}`))
      const aliceEntry = currentEntry()

      let popped = nextPopState()
      act(() => window.history.back())
      await act(() => popped)
      await user.click(await screen.findByRole('button', { name: /1 unnamed voice/ }))

      // Waited for outside act(), so the stand-in's own act() renders at once,
      // inside the event, as the browser would.
      popped = nextPopState()
      window.history.forward()
      await popped
      await act(async () => {})

      expect(await screen.findByRole('dialog', { name: 'Alice' })).toBeInTheDocument()
      expect(view.baseElement.querySelector('button[aria-controls]')).toHaveAttribute('aria-expanded', 'true')
      expect(savedViews()[aliceEntry]?.voicesOpen).toBe(true)
      window.removeEventListener('popstate', routerFirst)
    })

    test('re-opening a person starts at the top, on screen as in what is saved', async () => {
      const user = userEvent.setup()
      mockFetchAppearances.mockResolvedValue([appearance('t-root', 'root', 'Risk assessment')])
      const { baseElement } = render(<Harness />)
      await user.click(await screen.findByTestId(`person-row-${ALICE}`))
      await screen.findByTestId('appearance-t-root')
      const personBody = baseElement.querySelectorAll<HTMLElement>('[role=dialog] .overflow-y-auto')[1]
      personBody.scrollTop = 60
      personBody.dispatchEvent(new Event('scroll'))

      await user.click(screen.getByRole('button', { name: 'People in Dechra' }))
      await screen.findByRole('dialog', { name: 'People in Dechra' })
      // Sliding away, her screen keeps its place: nothing jumps on the way out.
      expect(personBody.scrollTop).toBe(60)

      await user.click(screen.getByTestId(`person-row-${ALICE}`))

      await waitFor(() => expect(personBody.scrollTop).toBe(0))
      expect(savedViews()[currentEntry()]?.personScroll).toBe(0)
    })

    test('a failed load of the transcripts keeps the scroll to restore after Try again', async () => {
      const user = userEvent.setup()
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockFetchAppearances
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce([appearance('t-root', 'root', 'Risk assessment')])
      seed('e1', { query: '', voicesOpen: false, listScroll: 0, personScroll: 80 })
      arriveAt(`?people=${ALICE}`, { projectPeople: { entry: 'e1', pushed: true, depth: 2, rooted: true } })
      const { baseElement } = render(<Harness />)

      const failed = await screen.findByText(/Couldn.t load the transcripts/)
      const personBody = baseElement.querySelectorAll<HTMLElement>('[role=dialog] .overflow-y-auto')[1]
      expect(personBody.scrollTop).toBe(0)

      await user.click(within(failed).getByRole('button', { name: 'Try again' }))
      spy.mockRestore()

      expect(await screen.findByTestId('appearance-t-root')).toBeInTheDocument()
      await waitFor(() => expect(personBody.scrollTop).toBe(80))
    })
  })
})
