import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PeopleLayout from '@/app/people/layout'
import PeoplePage from '@/app/people/page'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { DirectoryOrganisation, DirectoryPerson, PeopleDirectory } from '@/contracts/db'
import {
  createPerson,
  deleteOrganisation,
  fetchPeopleDirectory,
  renameOrganisation,
} from '@/lib/supabase/queries'
import { makeTranscript, transcriptProviderData } from '../projects/fixtures'

const mockPush = jest.fn()
let mockSearch = ''
jest.mock('next/navigation', () => ({
  usePathname: () => '/people',
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

const mockUseTranscriptsData = jest.fn()
jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useTranscriptsData: () => mockUseTranscriptsData(),
  useProjectsData: () => require('../projects/fixtures').projectProviderData([]),
}))

const mockToast = jest.fn()
jest.mock('@/components/ui/toaster', () => ({ toast: (...args: unknown[]) => mockToast(...args) }))

const TRANSCRIPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const person = (overrides: Partial<DirectoryPerson> & { id: string; name: string }): DirectoryPerson => ({
  user_id: 'u1', organisation_id: null, organisation_name: null, preferred_color: '#4F638C', hidden: false,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', transcript_count: 0, last_seen_at: null,
  ...overrides,
})
const organisation = (id: string, name: string, personCount: number): DirectoryOrganisation => ({
  id, user_id: 'u1', name, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', person_count: personCount,
})

const alex = person({ id: 'alex', name: 'Alex Morgan', organisation_id: 'acme', organisation_name: 'ACME',
  transcript_count: 2, last_seen_at: '2026-09-10T00:00:00Z' })
const blair = person({ id: 'blair', name: 'Blair', transcript_count: 1, last_seen_at: '2026-09-20T00:00:00Z' })
const casey = person({ id: 'casey', name: 'Casey', hidden: true, transcript_count: 1, last_seen_at: '2026-09-15T00:00:00Z' })
const directory: PeopleDirectory = {
  people: [alex, blair, casey],
  organisations: [organisation('acme', 'ACME', 1)],
}

const rowNames = () => screen.getAllByTestId(/^person-row-/).map((row) => row.getAttribute('data-testid'))

const page = () => <TooltipProvider><PeopleLayout><PeoplePage /></PeopleLayout></TooltipProvider>

async function renderPage(data: PeopleDirectory = directory) {
  jest.mocked(fetchPeopleDirectory).mockResolvedValue(data)
  const user = userEvent.setup()
  render(page())
  await screen.findByRole('heading', { name: 'People', level: 1 })
  return user
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearch = ''
  mockUseTranscriptsData.mockReturnValue(transcriptProviderData([
    makeTranscript({ id: TRANSCRIPT_ID, title: 'Q3 steering' }),
  ]))
})

test('lists people by most recent appearance, with their organisation, count and last seen', async () => {
  await renderPage()

  // Casey is hidden, so not listed by default.
  expect(rowNames()).toEqual(['person-row-blair', 'person-row-alex'])
  const alexRow = screen.getByTestId('person-row-alex')
  expect(alexRow).toHaveAttribute('href', '/people/alex')
  expect(within(alexRow).getByText('ACME')).toBeInTheDocument()
  expect(within(alexRow).getByText('2 transcripts')).toBeInTheDocument()
  expect(within(alexRow).getByText(/^Last seen /)).toBeInTheDocument()
})

test('a person in no transcript says so', async () => {
  await renderPage({ ...directory, people: [person({ id: 'new', name: 'New Person' })] })
  expect(screen.getByText('Not in any transcript yet')).toBeInTheDocument()
})

test('search matches name or organisation, ignoring case and outer spaces', async () => {
  const user = await renderPage()

  await user.type(screen.getByRole('textbox', { name: 'Search people' }), '  acme ')
  expect(rowNames()).toEqual(['person-row-alex'])

  await user.clear(screen.getByRole('textbox', { name: 'Search people' }))
  await user.type(screen.getByRole('textbox', { name: 'Search people' }), 'BLA')
  expect(rowNames()).toEqual(['person-row-blair'])
})

test('hidden people appear, marked, only with Show hidden on', async () => {
  const user = await renderPage()

  await user.type(screen.getByRole('textbox', { name: 'Search people' }), 'casey')
  expect(screen.getByText(/1 hidden person matches; turn on Show hidden/)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /^Show hidden/ }))
  expect(rowNames()).toEqual(['person-row-casey'])
  expect(within(screen.getByTestId('person-row-casey')).getByText('Hidden')).toBeInTheDocument()
})

test('Show hidden is offered only when someone is hidden', async () => {
  await renderPage({ ...directory, people: [alex, blair] })
  expect(screen.queryByRole('button', { name: /^Show hidden/ })).not.toBeInTheDocument()
})

test('the order switch sorts by name', async () => {
  const user = await renderPage()
  const byName = screen.getByRole('button', { name: 'Name A–Z' })
  expect(byName).toHaveAttribute('aria-pressed', 'false')
  await user.click(byName)
  expect(byName).toHaveAttribute('aria-pressed', 'true')
  expect(rowNames()).toEqual(['person-row-alex', 'person-row-blair'])
})

test('Clear search and filter brings everyone back', async () => {
  const user = await renderPage()
  await user.type(screen.getByRole('textbox', { name: 'Search people' }), 'nobody')
  expect(screen.getByText(/No people match/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Clear search and filter' }))
  expect(screen.getByRole('textbox', { name: 'Search people' })).toHaveValue('')
  expect(rowNames()).toEqual(['person-row-blair', 'person-row-alex'])
})

describe('the organisation filter', () => {
  const chip = (name: RegExp) => within(screen.getByRole('group', { name: 'Organisation' })).getByRole('button', { name })

  test('offers All, each organisation and No organisation, with the people each would list', async () => {
    const user = await renderPage()
    const filter = screen.getByRole('group', { name: 'Organisation' })
    // Casey is hidden, so not counted until Show hidden is on.
    expect(within(filter).getAllByRole('button').map((option) => option.textContent))
      .toEqual(['All 2', 'ACME1', 'No organisation1'])
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /^More options for/ })).not.toBeInTheDocument()

    await user.click(chip(/^No organisation/))
    expect(rowNames()).toEqual(['person-row-blair'])
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: /^More options for/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Show hidden/ }))
    expect(chip(/^No organisation/)).toHaveTextContent('No organisation2')
  })

  test('chips turn on and off, and several on show anyone in any of them', async () => {
    const globex = organisation('globex', 'Globex', 1)
    const dana = person({ id: 'dana', name: 'Dana', organisation_id: 'globex', organisation_name: 'Globex',
      transcript_count: 1, last_seen_at: '2026-09-05T00:00:00Z' })
    const user = await renderPage({ people: [alex, blair, casey, dana], organisations: [organisation('acme', 'ACME', 1), globex] })

    await user.click(chip(/^ACME/))
    await user.click(chip(/^Globex/))
    expect(rowNames()).toEqual(['person-row-alex', 'person-row-dana'])
    expect(chip(/^ACME/)).toHaveAttribute('aria-pressed', 'true')
    expect(chip(/^Globex/)).toHaveAttribute('aria-pressed', 'true')
    // Rename and delete are for one organisation at a time.
    expect(screen.queryByRole('button', { name: /^More options for/ })).not.toBeInTheDocument()

    await user.click(chip(/^ACME/))
    expect(rowNames()).toEqual(['person-row-dana'])
    expect(screen.getByRole('button', { name: 'More options for Globex' })).toBeInTheDocument()

    // Turning the last one off, or choosing All, shows everyone again.
    await user.click(chip(/^Globex/))
    expect(rowNames()).toEqual(['person-row-blair', 'person-row-alex', 'person-row-dana'])
    await user.click(chip(/^ACME/))
    await user.click(chip(/^No organisation/))
    await user.click(chip(/^All/))
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true')
    expect(rowNames()).toEqual(['person-row-blair', 'person-row-alex', 'person-row-dana'])
  })

  test('there is no filter until there is an organisation', async () => {
    await renderPage({ ...directory, organisations: [] })
    expect(screen.queryByRole('group', { name: 'Organisation' })).not.toBeInTheDocument()
  })

  test('with one organisation selected, it can be renamed', async () => {
    jest.mocked(renameOrganisation).mockResolvedValue({ ...organisation('acme', 'ACME Ltd', 1) })
    const user = await renderPage()

    await user.click(chip(/^ACME/))
    expect(rowNames()).toEqual(['person-row-alex'])

    await user.click(screen.getByRole('button', { name: 'More options for ACME' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename organisation' }))
    const field = screen.getByRole('textbox', { name: 'Organisation name' })
    await user.clear(field)
    await user.type(field, ' ACME Ltd ')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => expect(renameOrganisation).toHaveBeenCalledWith('acme', 'ACME', 'ACME Ltd'))
    await waitFor(() => expect(fetchPeopleDirectory).toHaveBeenCalledTimes(2))
  })

  test('a duplicate organisation name is refused in the dialog', async () => {
    jest.mocked(renameOrganisation).mockRejectedValue({ code: '23505' })
    const user = await renderPage()

    await user.click(chip(/^ACME/))
    await user.click(screen.getByRole('button', { name: 'More options for ACME' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename organisation' }))
    await user.type(screen.getByRole('textbox', { name: 'Organisation name' }), ' 2')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Another organisation already has that name.')
  })

  test('deleting it clears it from its people and deletes nobody', async () => {
    jest.mocked(deleteOrganisation).mockResolvedValue(undefined)
    const user = await renderPage()

    await user.click(chip(/^ACME/))
    await user.click(screen.getByRole('button', { name: 'More options for ACME' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete organisation' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('1 person will have no organisation. No person is deleted.')
    await user.click(within(dialog).getByRole('button', { name: 'Delete organisation' }))

    await waitFor(() => expect(deleteOrganisation).toHaveBeenCalledWith('acme'))
    expect(mockToast).toHaveBeenCalledWith({ title: 'Deleted ACME' })
  })
})

describe('adding a person', () => {
  test('keeps the created person in the directory if the follow-up read fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const created = { ...blair, id: 'new-person', name: 'Dana' }
    jest.mocked(createPerson).mockResolvedValue(created)
    const user = await renderPage()
    jest.mocked(fetchPeopleDirectory).mockRejectedValueOnce(new Error('offline'))
    await user.click(screen.getByRole('button', { name: 'New person' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Dana')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/people/new-person'))
    expect(screen.getByTestId('person-row-new-person')).toHaveTextContent('Dana')
    expect(screen.getByTestId('person-row-new-person')).toHaveTextContent('0 transcripts')
  })
  test('an empty directory explains both ways to add someone', async () => {
    await renderPage({ people: [], organisations: [] })
    expect(screen.getByText(/In a transcript, click a speaker and identify them as a person/)).toBeInTheDocument()
    expect(screen.getByText(/Or create a person here/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New person' })).toBeInTheDocument()
  })

  test('a namesake is created knowingly, with Create another', async () => {
    jest.mocked(createPerson).mockResolvedValue({ ...blair, id: 'blair-2' })
    mockSearch = `from=${TRANSCRIPT_ID}`
    const user = await renderPage()

    await user.click(screen.getByRole('button', { name: 'New person' }))
    const field = screen.getByRole('textbox', { name: 'Name' })
    await user.type(field, 'Blai')
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    await user.type(field, 'r ')
    expect(screen.getByText('Already in your directory:')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create another “Blair”' }))

    await waitFor(() => expect(createPerson).toHaveBeenCalledWith('Blair'))
    // Straight to their page, keeping the way back to the editor.
    expect(mockPush).toHaveBeenCalledWith(`/people/blair-2?from=${TRANSCRIPT_ID}`)
  })

  test('a blank name is not sent', async () => {
    const user = await renderPage()
    await user.click(screen.getByRole('button', { name: 'New person' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '   ')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.')
    expect(createPerson).not.toHaveBeenCalled()
  })
})

test('arriving from the editor offers the way back and keeps it on every link', async () => {
  mockSearch = `from=${TRANSCRIPT_ID}`
  await renderPage()

  expect(screen.getByRole('link', { name: 'Back to “Q3 steering”' })).toHaveAttribute('href', `/editor/${TRANSCRIPT_ID}`)
  expect(screen.getByTestId('person-row-blair')).toHaveAttribute('href', `/people/blair?from=${TRANSCRIPT_ID}`)
})

test('a from that is not a transcript id is ignored', async () => {
  mockSearch = 'from=javascript:alert(1)'
  await renderPage()
  expect(screen.queryByRole('link', { name: /Back to/ })).not.toBeInTheDocument()
  expect(screen.getByTestId('person-row-blair')).toHaveAttribute('href', '/people/blair')
})

test('a failed load offers to try again', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.mocked(fetchPeopleDirectory).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(directory)
  const user = userEvent.setup()
  render(page())

  await user.click(await screen.findByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('heading', { name: 'People', level: 1 })).toBeInTheDocument()
})
