import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import FindReplaceModal from '../components/FindReplaceModal'

const baseProps = {
  open: true,
  onClose: jest.fn(),
  findInput: 'hello',
  setFindInput: jest.fn(),
  findTerm: 'hello',
  replaceTerm: 'earth',
  setReplaceTerm: jest.fn(),
  caseSensitive: false,
  setCaseSensitive: jest.fn(),
  wholeWord: false,
  setWholeWord: jest.fn(),
  onNext: jest.fn(),
  onPrev: jest.fn(),
  onReplace: jest.fn(),
  onReplaceAll: jest.fn(),
  onFindKeyDown: jest.fn(),
  onClear: jest.fn(),
  matchSummary: '1 of 1 matches',
  canNavigate: true,
  canReplace: true,
  hasMatches: true,
  matches: [{ segId: 's1', index: 0, length: 5 }],
  segments: [{ id: 's1', text: 'hello world' }],
  matchIndex: 0,
  onMatchClick: jest.fn(),
}

describe('FindReplaceModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('delays Escape close long enough for the flash state to render', () => {
    const onClose = jest.fn()
    render(<FindReplaceModal {...baseProps} onClose={onClose} />)

    const escButton = screen.getByRole('button', { name: /close find\/replace/i })
    const dialog = screen.getByRole('dialog', { name: /find and replace/i })

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(escButton.className).toContain('bg-ink/10')
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(79)
    })
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('restores focus to the opener after closing', () => {
    function Harness() {
      const [open, setOpen] = React.useState(false)

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open search
          </button>
          <FindReplaceModal
            {...baseProps}
            open={open}
            onClose={() => setOpen(false)}
          />
        </>
      )
    }

    render(<Harness />)

    const openButton = screen.getByRole('button', { name: /open search/i })
    openButton.focus()
    expect(openButton).toHaveFocus()
    fireEvent.click(openButton)

    const dialog = screen.getByRole('dialog', { name: /find and replace/i })
    fireEvent.keyDown(dialog, { key: 'Escape' })

    act(() => {
      jest.advanceTimersByTime(80)
      jest.runOnlyPendingTimers()
    })

    expect(openButton).toHaveFocus()
  })

  test('restores focus when the parent closes the modal from Enter', () => {
    function Harness() {
      const [open, setOpen] = React.useState(false)

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open search
          </button>
          <FindReplaceModal
            {...baseProps}
            open={open}
            onClose={() => setOpen(false)}
            onFindKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                setOpen(false)
              }
            }}
          />
        </>
      )
    }

    render(<Harness />)

    const openButton = screen.getByRole('button', { name: /open search/i })
    openButton.focus()
    fireEvent.click(openButton)

    const findInput = screen.getByRole('textbox', { name: /find text/i })
    fireEvent.keyDown(findInput, { key: 'Enter' })

    act(() => {
      jest.runOnlyPendingTimers()
    })

    expect(openButton).toHaveFocus()
  })
})
