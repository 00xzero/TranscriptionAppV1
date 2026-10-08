import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PersonPage from '@/app/people/[id]/page'
import type { DirectoryPerson, MergePreview, PeopleDirectory, PersonAppearance } from '@/contracts/db'
import {
  deletePerson,
  fetchMergePreview,
  fetchPeopleDirectory,
  fetchPersonAppearances,
  mergePeople,
  reassignSegments,
  removePersonFromTranscript,
  renamePerson,
  setPersonColor,
  setPersonHidden,
  setPersonOrganisation,
} from '@/lib/supabase/queries'
import { makeProject, makeTranscript, projectProviderData, transcriptProviderData } from '../projects/fixtures'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'
const BLAIR_ID = '22222222-2222-4222-8222-222222222222'
const CASEY_ID = '33333333-3333-4333-8333-333333333333'
const TRANSCRIPT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TRANSCRIPT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SEGMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LINKED_SPEAKER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const DETECTED_SPEAKER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const mockPush = jest.fn()
let mockSearch = ''
let mockId = PERSON_ID
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: mockId }),
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))

const mockUseTranscriptsData = jest.fn()
const mockUseProjectsData = jest.fn()
jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useTranscriptsData: () => mockUseTranscriptsData(),
  useProjectsData: () => mockUseProjectsData(),
}))

const mockToast = jest.fn()
jest.mock('@/components/ui/toaster', () => ({ toast: (...args: unknown[]) => mockToast(...args) }))

const person = (overrides: Partial<DirectoryPerson> & { id: string; name: string }): DirectoryPerson => ({
  user_id: 'u1', organisation_id: null, organisation_name: null, preferred_color: '#4F638C', hidden: false,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', transcript_count: 0, last_seen_at: null,
  ...overrides,
})

const alex = person({ id: PERSON_ID, name: 'Alex Morgan', transcript_count: 2, last_seen_at: '2026-09-20T00:00:00Z' })
const blair = person({ id: BLAIR_ID, name: 'Blair', organisation_id: 'acme', organisation_name: 'ACME', transcript_count: 1 })
const casey = person({ id: CASEY_ID, name: 'Casey', organisation_id: 'globex', organisation_name: 'Globex', hidden: true })
const directory: PeopleDirectory = {
  people: [alex, blair, casey],
  organisations: [
    { id: 'acme', user_id: 'u1', name: 'ACME', created_at: '', updated_at: '', person_count: 1 },
    { id: 'globex', user_id: 'u1', name: 'Globex', created_at: '', updated_at: '', person_count: 1 },
  ],
}
const appearances: PersonAppearance[] = [
  { transcript_id: TRANSCRIPT_B, title: 'Q3 steering', project_id: 'project-a', created_at: '2026-09-20T00:00:00Z', segment_count: 1 },
  { transcript_id: TRANSCRIPT_A, title: null, project_id: null, created_at: '2026-09-10T00:00:00Z', segment_count: 4 },
]

async function renderPage({ people = directory, rows = appearances }: { people?: PeopleDirectory; rows?: PersonAppearance[] } = {}) {
  jest.mocked(fetchPeopleDirectory).mockResolvedValue(people)
  jest.mocked(fetchPersonAppearances).mockResolvedValue(rows)
  const user = userEvent.setup()
  render(<PersonPage />)
  await screen.findByRole('heading', { level: 1 })
  await screen.findByRole('heading', { name: 'Appearances' })
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Delete person$/ })).toBeInTheDocument())
  return user
}

/** The last toast with an action, run as if its button were clicked. */
async function clickToastAction(label: string) {
  const call = [...mockToast.mock.calls].reverse().find(([options]) => options.action?.label === label)
  if (!call) throw new Error(`No toast offered ${label}`)
  await call[0].action.onClick()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearch = ''
  mockId = PERSON_ID
  mockUseTranscriptsData.mockReturnValue(transcriptProviderData([
    makeTranscript({ id: TRANSCRIPT_B, title: 'Q3 steering' }),
  ]))
  mockUseProjectsData.mockReturnValue(projectProviderData([makeProject({ id: 'project-a', name: 'Client work' })]))
})

test('shows the person and their appearances, newest first', async () => {
  await renderPage()

  expect(screen.getByRole('heading', { level: 1, name: 'Alex Morgan' })).toBeInTheDocument()
  expect(screen.getByText('No organisation')).toBeInTheDocument()
  expect(screen.getByText('Denim')).toBeInTheDocument()

  const [newest, older] = screen.getAllByTestId(/^appearance-/)
  expect(within(newest).getByRole('link', { name: /Q3 steering/ })).toHaveAttribute('href', `/editor/${TRANSCRIPT_B}`)
  expect(newest).toHaveTextContent('Client work')
  expect(newest).toHaveTextContent('1 segment')
  expect(within(older).getByRole('link', { name: /Untitled/ })).toBeInTheDocument()
  expect(older).toHaveTextContent('Unfiled')
  expect(older).toHaveTextContent('4 segments')
})

test('arriving from the editor offers the way back', async () => {
  mockSearch = `from=${TRANSCRIPT_B}`
  await renderPage()
  expect(screen.getByRole('link', { name: 'Back to “Q3 steering”' })).toHaveAttribute('href', `/editor/${TRANSCRIPT_B}`)
})

test('someone merged away or deleted is not found', async () => {
  jest.mocked(fetchPeopleDirectory).mockResolvedValue({ ...directory, people: [blair] })
  render(<PersonPage />)
  expect(await screen.findByRole('heading', { name: 'Person not found' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View people' })).toHaveAttribute('href', '/people')
})

test('a malformed id is a 404', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockId = 'not-a-uuid'
  expect(() => render(<PersonPage />)).toThrow('NEXT_NOT_FOUND')
  expect(fetchPeopleDirectory).not.toHaveBeenCalled()
})

describe('delete', () => {
  test('is disabled while the person appears anywhere', async () => {
    await renderPage()
    const button = screen.getByRole('button', { name: 'Delete person' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Remove or merge first')
  })

  test('with no appearances, it confirms and returns to the list', async () => {
    jest.mocked(deletePerson).mockResolvedValue(undefined)
    mockSearch = `from=${TRANSCRIPT_B}`
    const user = await renderPage({ rows: [] })

    expect(screen.getByText(/isn.t in any transcript yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete person' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete person' }))

    await waitFor(() => expect(deletePerson).toHaveBeenCalledWith(PERSON_ID))
    expect(mockPush).toHaveBeenCalledWith(`/people?from=${TRANSCRIPT_B}`)
  })

  test('the database refusing it says why', async () => {
    jest.mocked(deletePerson).mockRejectedValue({ code: 'SP002' })
    const user = await renderPage({ rows: [] })

    await user.click(screen.getByRole('button', { name: 'Delete person' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete person' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Alex Morgan now appears in a transcript. Remove or merge first.')
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('remove from this transcript', () => {
  const changes = [{ segment_id: SEGMENT_ID, expected_speaker_id: LINKED_SPEAKER, speaker_id: DETECTED_SPEAKER }]

  test('removes the person there and offers Undo, which swaps each change back', async () => {
    let finish: (value: typeof changes) => void = () => {}
    jest.mocked(removePersonFromTranscript).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    jest.mocked(reassignSegments).mockResolvedValue([])
    const user = await renderPage()
    jest.mocked(fetchPersonAppearances).mockResolvedValue([appearances[1]])

    await user.click(screen.getByRole('button', { name: 'Remove Alex Morgan from “Q3 steering”' }))

    // The row goes at once, before the database answers.
    expect(removePersonFromTranscript).toHaveBeenCalledWith(PERSON_ID, TRANSCRIPT_B)
    expect(screen.queryByTestId(`appearance-${TRANSCRIPT_B}`)).not.toBeInTheDocument()
    finish(changes)
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Removed Alex Morgan from “Q3 steering”', durationMs: 8000 })))

    await clickToastAction('Undo')
    expect(reassignSegments).toHaveBeenCalledWith(TRANSCRIPT_B, [
      { segment_id: SEGMENT_ID, expected_speaker_id: DETECTED_SPEAKER, speaker_id: LINKED_SPEAKER },
    ])
  })

  test('an Undo refused because something moved since says so', async () => {
    jest.mocked(removePersonFromTranscript).mockResolvedValue(changes)
    jest.mocked(reassignSegments).mockRejectedValue({ code: 'SP002' })
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Remove Alex Morgan from “Q3 steering”' }))
    await waitFor(() => expect(removePersonFromTranscript).toHaveBeenCalled())
    await clickToastAction('Undo')

    expect(mockToast).toHaveBeenLastCalledWith({ title: "Can't undo — changed since", variant: 'error' })
  })

  test('a refused removal reloads and says another tab changed it', async () => {
    jest.mocked(removePersonFromTranscript).mockRejectedValue({ code: 'SP002' })
    const user = await renderPage()
    const loads = jest.mocked(fetchPersonAppearances).mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Remove Alex Morgan from “Q3 steering”' }))

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Changed in another tab — refreshed', variant: 'error' }))
    await waitFor(() => expect(jest.mocked(fetchPersonAppearances).mock.calls.length).toBeGreaterThan(loads))
  })

  test('any other failure offers Retry', async () => {
    jest.mocked(removePersonFromTranscript).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(changes)
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Remove Alex Morgan from “Q3 steering”' }))
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Couldn\'t remove Alex Morgan from “Q3 steering”', variant: 'error' })))

    await clickToastAction('Retry')
    expect(removePersonFromTranscript).toHaveBeenCalledTimes(2)
  })

  // The row is hidden at once; if the write fails and the reload fails too,
  // the page must not be left showing an appearance the database still has.
  test('a failed removal shows the row again, even when the reload also fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.mocked(removePersonFromTranscript).mockRejectedValue(new Error('offline'))
    const user = await renderPage({ rows: [appearances[0]] })
    jest.mocked(fetchPersonAppearances).mockRejectedValue(new Error('offline'))
    jest.mocked(fetchPeopleDirectory).mockRejectedValue(new Error('offline'))

    await user.click(screen.getByRole('button', { name: 'Remove Alex Morgan from “Q3 steering”' }))

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Couldn\'t remove Alex Morgan from “Q3 steering”' })))
    await waitFor(() => expect(fetchPersonAppearances).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId(`appearance-${TRANSCRIPT_B}`)).toBeInTheDocument()
    // Still an appearance, so Delete stays off.
    expect(screen.getByRole('button', { name: 'Delete person' })).toBeDisabled()
  })

  test('a person merged away in another tab reloads instead of offering Retry', async () => {
    jest.mocked(removePersonFromTranscript).mockRejectedValue({ code: 'SP001' })
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Remove Alex Morgan from “Q3 steering”' }))

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Changed in another tab — refreshed', variant: 'error' }))
    expect(mockToast.mock.calls.some(([options]) => options.action?.label === 'Retry')).toBe(false)
  })

  test('a successful Undo shows the row again, in its place, before any reload', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.mocked(removePersonFromTranscript).mockResolvedValue(changes)
    jest.mocked(reassignSegments).mockResolvedValue([])
    const user = await renderPage()
    // Every reload from here on fails, so only Undo itself can bring the row back.
    jest.mocked(fetchPersonAppearances).mockRejectedValue(new Error('offline'))
    jest.mocked(fetchPeopleDirectory).mockRejectedValue(new Error('offline'))

    await user.click(screen.getByRole('button', { name: 'Remove Alex Morgan from “Q3 steering”' }))
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Removed Alex Morgan from “Q3 steering”' })))
    expect(screen.queryByTestId(`appearance-${TRANSCRIPT_B}`)).not.toBeInTheDocument()

    await clickToastAction('Undo')

    await waitFor(() => expect(screen.getAllByTestId(/^appearance-/).map((row) => row.dataset.testid))
      .toEqual([`appearance-${TRANSCRIPT_B}`, `appearance-${TRANSCRIPT_A}`]))
  })
})

describe('editing the person', () => {
  test('rename sends the name it replaces', async () => {
    jest.mocked(renamePerson).mockResolvedValue({ ...alex, name: 'Alex' })
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Rename person' }))
    const field = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(field)
    await user.type(field, 'Alex')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => expect(renamePerson).toHaveBeenCalledWith(PERSON_ID, 'Alex Morgan', 'Alex'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('a rename refused by another tab closes, reloads and says so', async () => {
    jest.mocked(renamePerson).mockRejectedValue({ code: 'SP002' })
    const user = await renderPage()
    const loads = jest.mocked(fetchPeopleDirectory).mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Rename person' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '!')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Changed in another tab — refreshed', variant: 'error' }))
    expect(jest.mocked(fetchPeopleDirectory).mock.calls.length).toBeGreaterThan(loads)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('organisation: an existing one by id, matched ignoring case rather than created again', async () => {
    jest.mocked(setPersonOrganisation).mockResolvedValue({ person: alex, organisation: null })
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Change organisation' }))
    await user.type(screen.getByRole('combobox', { name: 'Organisation' }), 'acme')
    expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'ACME' }))

    await waitFor(() => expect(setPersonOrganisation).toHaveBeenCalledWith(PERSON_ID, null, { organisationId: 'acme' }))
  })

  test('organisation: a new name is created when nothing matches', async () => {
    jest.mocked(setPersonOrganisation).mockResolvedValue({ person: alex, organisation: null })
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Change organisation' }))
    await user.type(screen.getByRole('combobox', { name: 'Organisation' }), ' Initech {Enter}')

    await waitFor(() => expect(setPersonOrganisation).toHaveBeenCalledWith(PERSON_ID, null, { newOrganisationName: 'Initech' }))
  })

  test('organisation: No organisation clears it, guarded by the current one', async () => {
    jest.mocked(setPersonOrganisation).mockResolvedValue({ person: blair, organisation: null })
    mockId = BLAIR_ID
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Change organisation' }))
    await user.click(screen.getByRole('option', { name: 'No organisation' }))

    await waitFor(() => expect(setPersonOrganisation).toHaveBeenCalledWith(BLAIR_ID, 'acme', null))
  })

  test('colour: another palette colour, guarded by the current one', async () => {
    jest.mocked(setPersonColor).mockResolvedValue(alex)
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Change colour' }))
    expect(screen.getByRole('radio', { name: 'Denim' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Teal' }))
    await user.click(screen.getByRole('button', { name: 'Save colour' }))

    await waitFor(() => expect(setPersonColor).toHaveBeenCalledWith(PERSON_ID, '#4F638C', '#0D9488'))
  })

  test('hide and unhide', async () => {
    jest.mocked(setPersonHidden).mockResolvedValue({ ...alex, hidden: true })
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(setPersonHidden).toHaveBeenCalledWith(PERSON_ID, true))
    expect(mockToast).toHaveBeenCalledWith({ title: 'Alex Morgan is hidden from suggestions' })
  })
})

describe('merge', () => {
  const preview: MergePreview = {
    survivor_transcript_ids: [TRANSCRIPT_B],
    people: [
      { person_id: CASEY_ID, transcripts: [] },
      { person_id: BLAIR_ID, transcripts: [{
        transcript_id: TRANSCRIPT_B, title: 'Q3 steering', created_at: '2026-09-20T00:00:00Z',
        voices: [
          { speaker_id: LINKED_SPEAKER, custom_label: null, segment_count: 3, detected_ordinals: [2] },
          { speaker_id: DETECTED_SPEAKER, custom_label: 'Blair (typo)', segment_count: 1, detected_ordinals: [1] },
        ],
      }] },
    ],
  }

  test('previews every transcript and voice that will move, then merges in the order picked', async () => {
    jest.mocked(fetchMergePreview).mockResolvedValue(preview)
    jest.mocked(mergePeople).mockResolvedValue(alex)
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Merge people' }))
    const dialog = screen.getByRole('dialog')
    // Hidden people can be merged too.
    await user.click(within(dialog).getByRole('checkbox', { name: /Casey/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /Blair/ }))

    await waitFor(() => expect(fetchMergePreview).toHaveBeenLastCalledWith(PERSON_ID, [CASEY_ID, BLAIR_ID]))
    const moving = await within(dialog).findByRole('region', { name: 'What will move' })
    // Alex has no organisation, so takes the first picked person's: Casey's.
    expect(moving).toHaveTextContent('Alex Morgan keeps their name and colour, and takes Globex from Casey.')
    expect(moving).toHaveTextContent('Not in any transcript.')
    expect(moving).toHaveTextContent('Q3 steering')
    expect(moving).toHaveTextContent('shows as one with Alex Morgan')
    expect(moving).toHaveTextContent('From Speaker 2 · 3 segments')
    expect(moving).toHaveTextContent('Blair (typo) · 1 segment')

    await user.click(within(dialog).getByRole('button', { name: 'Merge 2 people' }))
    await waitFor(() => expect(mergePeople).toHaveBeenCalledWith(PERSON_ID, [CASEY_ID, BLAIR_ID]))
    expect(mockToast).toHaveBeenCalledWith({ title: 'Merged 2 people into Alex Morgan' })
  })

  test('a donor whose name ends in a full stop does not double it', async () => {
    jest.mocked(fetchMergePreview).mockResolvedValue({ survivor_transcript_ids: [],
      people: [{ person_id: BLAIR_ID, transcripts: [] }] })
    const user = await renderPage({ people: { ...directory, people: [alex, { ...blair, name: 'Blair B.' }, casey] } })

    await user.click(screen.getByRole('button', { name: 'Merge people' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /Blair B\./ }))

    expect(await screen.findByText('Alex Morgan keeps their name and colour, and takes ACME from Blair B.'))
      .toBeInTheDocument()
  })

  test('cannot merge before the preview has loaded', async () => {
    jest.mocked(fetchMergePreview).mockReturnValue(new Promise(() => {}))
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Merge people' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /Blair/ }))

    expect(screen.getByText('Loading what will move…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge 1 person' })).toBeDisabled()
  })

  test('changing the selection hides the old preview until the new one loads', async () => {
    jest.mocked(fetchMergePreview)
      .mockResolvedValueOnce({ ...preview, people: [preview.people[1]] })
      .mockReturnValueOnce(new Promise(() => {}))
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Merge people' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Blair/ }))
    expect(await within(dialog).findByText('Q3 steering')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('checkbox', { name: /Casey/ }))

    expect(within(dialog).getByText('Loading what will move…')).toBeInTheDocument()
    expect(within(dialog).queryByText('Q3 steering')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Merge 2 people' })).toBeDisabled()
  })

  test('a failed merge stays open and says so', async () => {
    jest.mocked(fetchMergePreview).mockResolvedValue({ ...preview, people: [preview.people[1]] })
    jest.mocked(mergePeople).mockRejectedValue({ code: 'SP001' })
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'Merge people' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /Blair/ }))
    const confirm = screen.getByRole('button', { name: 'Merge 1 person' })
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('That person no longer exists.')
  })
})
