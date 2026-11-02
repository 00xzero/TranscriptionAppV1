import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { TagPicker, type TagPickerHandlers } from '@/components/Tags/TagPicker'
import type { Tag } from '@/contracts/db'

const tag = (id: string, name: string, color = '#4F638C'): Tag => ({
  id, user_id: 'u1', name, color, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
})
const INTERVIEW = tag('g1', 'Interview')
const RESEARCH = tag('g2', 'Research', '#7C3AED')
const REVIEW = tag('g3', 'Needs review', '#CA8A04')

function handlers(overrides: Partial<TagPickerHandlers> = {}): TagPickerHandlers {
  return {
    onAdd: jest.fn(),
    onRemove: jest.fn(),
    onCreate: jest.fn(),
    onRename: jest.fn().mockResolvedValue(undefined),
    onRecolour: jest.fn().mockResolvedValue(undefined),
    onDelete: jest.fn().mockResolvedValue(undefined),
    onMerge: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// The picker as a list or the editor holds it: the selection lives outside.
function Harness({ actions, initial = [INTERVIEW], blocked = false }: {
  actions: TagPickerHandlers
  initial?: Tag[]
  blocked?: boolean
}) {
  const [selected, setSelected] = useState<Tag[]>(initial)
  return (
    <TagPicker
      title="Kickoff"
      tags={[INTERVIEW, REVIEW, RESEARCH]}
      selected={selected}
      countOf={(tagId) => (tagId === 'g1' ? 4 : 1)}
      blocked={blocked}
      handlers={{
        ...actions,
        onAdd: (added) => { actions.onAdd(added); setSelected((current) => [...current, added]) },
        onRemove: (removed) => { actions.onRemove(removed); setSelected((current) => current.filter((entry) => entry.id !== removed.id)) },
      }}
    />
  )
}

const search = () => screen.getByRole('combobox', { name: 'Search or create a tag' })

test('lists every tag, with the transcript’s own marked and removable', () => {
  render(<Harness actions={handlers()} />)
  const list = screen.getByRole('listbox', { name: 'Tags' })
  expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['Interview', 'Needs review', 'Research'])
  expect(within(list).getByRole('option', { name: 'Interview' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: 'Remove Interview' })).toBeInTheDocument()
  expect(search()).toHaveFocus()
})

test('Enter adds the highlighted tag, and removes it when it is already on', async () => {
  const user = userEvent.setup()
  const actions = handlers()
  render(<Harness actions={actions} />)
  await user.type(search(), 'res')
  await user.keyboard('{Enter}')
  expect(actions.onAdd).toHaveBeenCalledWith(RESEARCH)
  expect(search()).toHaveValue('')

  await user.type(search(), 'inter')
  await user.keyboard('{Enter}')
  expect(actions.onRemove).toHaveBeenCalledWith(INTERVIEW)
})

test('a name no tag has offers Create, and Enter creates it', async () => {
  const user = userEvent.setup()
  const actions = handlers()
  render(<Harness actions={actions} />)
  await user.type(search(), '  Client call ')
  expect(screen.getByRole('option', { name: /Create\s*Client call/ })).toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(actions.onCreate).toHaveBeenCalledWith('Client call')
})

test('a name a tag already has (ignoring case) offers that tag, not Create', async () => {
  const user = userEvent.setup()
  render(<Harness actions={handlers()} />)
  await user.type(search(), 'research')
  expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument()
})

test('Backspace in an empty field takes the last tag off', async () => {
  const user = userEvent.setup()
  const actions = handlers()
  render(<Harness actions={actions} initial={[INTERVIEW, RESEARCH]} />)
  await user.click(search())
  await user.keyboard('{Backspace}')
  expect(actions.onRemove).toHaveBeenCalledWith(RESEARCH)
})

test('while blocked, choices are turned away', async () => {
  const user = userEvent.setup()
  const actions = handlers()
  render(<Harness actions={actions} blocked />)
  await user.type(search(), 'res{Enter}')
  await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}')
  expect(actions.onAdd).not.toHaveBeenCalled()
  expect(actions.onRemove).not.toHaveBeenCalled()
})

describe('a tag’s ⋯ menu', () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(screen.getByRole('button', { name: `Options for ${name}` }))
    return screen.findByRole('textbox', { name: 'Name' })
  }

  test('says how many transcripts carry the tag', async () => {
    const user = userEvent.setup()
    render(<Harness actions={handlers()} />)
    await openMenu(user, 'Interview')
    expect(screen.getByText('On 4 transcripts')).toBeInTheDocument()
  })

  test('Enter saves a new name once, and the blur after it saves nothing more', async () => {
    const user = userEvent.setup()
    const actions = handlers()
    render(<Harness actions={actions} />)
    const field = await openMenu(user, 'Research')
    await user.clear(field)
    await user.type(field, 'Discovery{Enter}')
    await user.click(search())
    expect(actions.onRename).toHaveBeenCalledTimes(1)
    expect(actions.onRename).toHaveBeenCalledWith(RESEARCH, 'Discovery')
  })

  test('leaving the field saves the name', async () => {
    const user = userEvent.setup()
    const actions = handlers()
    render(<Harness actions={actions} />)
    const field = await openMenu(user, 'Research')
    await user.type(field, ' notes')
    await user.click(screen.getByText('Colour'))
    expect(actions.onRename).toHaveBeenCalledWith(RESEARCH, 'Research notes')
  })

  test('Escape puts the old name back, closes only the menu, and saves nothing', async () => {
    const user = userEvent.setup()
    const actions = handlers()
    render(<Harness actions={actions} />)
    const field = await openMenu(user, 'Research')
    await user.type(field, ' notes')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument())
    expect(actions.onRename).not.toHaveBeenCalled()
    expect(search()).toBeInTheDocument()
  })

  test('a refused rename shows why in the menu', async () => {
    const user = userEvent.setup()
    const actions = handlers({ onRename: jest.fn().mockRejectedValue(new Error('Another tag already has that name.')) })
    render(<Harness actions={actions} />)
    const field = await openMenu(user, 'Research')
    await user.type(field, ' notes{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Another tag already has that name.')
  })

  test('the name of another tag offers to merge, once, and confirming merges', async () => {
    const user = userEvent.setup()
    const actions = handlers()
    render(<Harness actions={actions} />)
    const field = await openMenu(user, 'Research')
    await user.clear(field)
    await user.type(field, 'interview')
    expect(screen.getByText(/“Interview” already exists/)).toBeInTheDocument()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Merge Research into Interview?')).toBeInTheDocument()
    expect(within(dialog).getByText(/The 1 transcript tagged Research will be tagged Interview instead/)).toBeInTheDocument()
    expect(actions.onRename).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }))
    expect(actions.onMerge).toHaveBeenCalledTimes(1)
    expect(actions.onMerge).toHaveBeenCalledWith(RESEARCH, INTERVIEW)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(search()).toHaveFocus())
  })

  test('Delete asks first, says what it affects, and gives focus back to the search', async () => {
    const user = userEvent.setup()
    const actions = handlers()
    render(<Harness actions={actions} />)
    await openMenu(user, 'Interview')
    await user.click(screen.getByRole('button', { name: 'Delete tag' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('It comes off 4 transcripts. No transcript is deleted.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(actions.onDelete).not.toHaveBeenCalled()
    await waitFor(() => expect(search()).toHaveFocus())
  })

  test('a colour applies at once', async () => {
    const user = userEvent.setup()
    const actions = handlers()
    render(<Harness actions={actions} />)
    await openMenu(user, 'Interview')
    await user.click(screen.getByRole('radio', { name: 'Teal' }))
    expect(actions.onRecolour).toHaveBeenCalledWith(INTERVIEW, '#0D9488')
  })
})

describe('before tags have loaded', () => {
  test('it says it is loading and takes no changes', () => {
    render(<TagPicker title="Kickoff" tags={[]} selected={[]} countOf={() => 0} handlers={handlers()} loadState="loading" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading tags…')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  test('a failed load offers Retry', async () => {
    const user = userEvent.setup()
    const onRetry = jest.fn().mockResolvedValue(false)
    render(<TagPicker title="Kickoff" tags={[]} selected={[]} countOf={() => 0} handlers={handlers()} loadState="failed" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load your tags.')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
