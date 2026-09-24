import React, { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTranscriptTitleEditing } from '@/app/editor/[id]/hooks/useTranscriptTitleEditing'
import { updateTranscript } from '@/lib/supabase/queries'

const updateTranscriptMock = updateTranscript as jest.MockedFunction<typeof updateTranscript>

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function TitleHarness({ onTitleSaved }: { onTitleSaved: (title: string) => void }) {
  const [title, setTitle] = useState<string | null>('Original title')
  const {
    editingTitle,
    titleInput,
    setTitleInput,
    titleSaveError,
    startEditingTitle,
    onTitleKeyDown,
    onTitleBlur,
  } = useTranscriptTitleEditing({
    transcriptId: 'transcript-1',
    transcriptTitle: title,
    setTranscriptTitle: setTitle,
    onTitleSaved,
  })

  return (
    <div>
      <span data-testid="saved-title">{title}</span>
      {editingTitle ? (
        <input
          aria-label="Transcript title"
          value={titleInput}
          onChange={(event) => setTitleInput(event.target.value)}
          onKeyDown={onTitleKeyDown}
          onBlur={onTitleBlur}
        />
      ) : (
        <button type="button" onClick={startEditingTitle}>Edit title</button>
      )}
      {titleSaveError && <span>{titleSaveError}</span>}
    </div>
  )
}

describe('useTranscriptTitleEditing', () => {
  beforeEach(() => {
    updateTranscriptMock.mockReset()
  })

  test('an over-long title is not saved and stays open until it fits or Escape cancels', async () => {
    const user = userEvent.setup()
    render(<TitleHarness onTitleSaved={jest.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Edit title' }))
    const input = screen.getByLabelText('Transcript title')
    await user.clear(input)
    await user.click(input)
    await user.paste('x'.repeat(130))
    await user.keyboard('{Enter}')
    act(() => input.blur())

    expect(updateTranscriptMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Transcript title')).toHaveValue('x'.repeat(130))
    expect(screen.getByText('Titles must be 120 characters or fewer.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Transcript title'), '{Backspace}'.repeat(10))
    expect(screen.queryByText('Titles must be 120 characters or fewer.')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.getByTestId('saved-title')).toHaveTextContent('Original title')
  })

  test('publishes a saved title after persistence resolves and before editing closes', async () => {
    const user = userEvent.setup()
    const save = deferred<Awaited<ReturnType<typeof updateTranscript>>>()
    updateTranscriptMock.mockReturnValueOnce(save.promise)
    const onTitleSaved = jest.fn(() => {
      expect(screen.getByRole('textbox', { name: 'Transcript title' })).toBeInTheDocument()
      expect(screen.getByTestId('saved-title')).toHaveTextContent('Original title')
    })
    render(<TitleHarness onTitleSaved={onTitleSaved} />)

    await user.click(screen.getByRole('button', { name: 'Edit title' }))
    const input = screen.getByRole('textbox', { name: 'Transcript title' })
    await user.clear(input)
    await user.type(input, 'Updated title{enter}')

    expect(updateTranscriptMock).toHaveBeenCalledWith('transcript-1', { title: 'Updated title' })
    expect(onTitleSaved).not.toHaveBeenCalled()

    await act(async () => save.resolve({} as Awaited<ReturnType<typeof updateTranscript>>))

    expect(onTitleSaved).toHaveBeenCalledWith('Updated title')
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Transcript title' })).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('saved-title')).toHaveTextContent('Updated title')
  })

  test('leaves provider and local title state untouched when persistence fails', async () => {
    const user = userEvent.setup()
    updateTranscriptMock.mockRejectedValueOnce(new Error('save failed'))
    const onTitleSaved = jest.fn()
    render(<TitleHarness onTitleSaved={onTitleSaved} />)

    await user.click(screen.getByRole('button', { name: 'Edit title' }))
    const input = screen.getByRole('textbox', { name: 'Transcript title' })
    await user.clear(input)
    await user.type(input, 'Rejected title{enter}')

    expect(await screen.findByText('Failed to save title. Please try again.')).toBeInTheDocument()
    expect(onTitleSaved).not.toHaveBeenCalled()
    expect(screen.getByTestId('saved-title')).toHaveTextContent('Original title')
    expect(screen.getByRole('textbox', { name: 'Transcript title' })).toHaveValue('Rejected title')
  })
})
