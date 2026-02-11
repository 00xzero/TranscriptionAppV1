import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import EditorPage from '../app/editor/[id]/page'
import * as supabaseQueries from '../lib/supabase/queries'

const makeJsonResponse = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
})

const makeExportResponse = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name: string) => name.toLowerCase() === 'content-disposition'
      ? 'attachment; filename="test-export.docx"'
      : null,
  },
  blob: async () => new Blob(['test'], { type: 'application/octet-stream' }),
})

const mockFetch = () => {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url
    const method = (init?.method || 'GET').toUpperCase()
    if (url.includes('/media-url') && method === 'GET') {
      return makeJsonResponse({ url: 'http://example.com/audio.mp3' })
    }
    if (url.includes('/api/projects/') && url.includes('/export/') && method === 'GET') {
      return makeExportResponse()
    }
    return makeJsonResponse('Not found', 404)
  })
  // @ts-ignore
  global.fetch = fetchMock
  return fetchMock
}

describe('EditorPage - Phase 7 UI regressions', () => {
  const waitForEditorContent = async () => {
    await screen.findByTestId('audio-player')
    const segmentsRendered = await screen.findAllByTestId('segment-card')
    expect(segmentsRendered.length).toBeGreaterThanOrEqual(2)
  }

  const openFindReplaceModalWithShortcut = async () => {
    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    await screen.findByPlaceholderText(/Search text/i)
  }

  const openFindReplaceModalWithEvent = async () => {
    window.dispatchEvent(new CustomEvent('open-find-replace'))
    await screen.findByPlaceholderText(/Search text/i)
  }

  const waitForMatchSummary = async (summaryPattern: RegExp) => {
    await waitFor(() => {
      expect(screen.getByTestId('match-summary')).toHaveTextContent(summaryPattern)
    }, { timeout: 2500 })
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8000'
    mockFetch()
    jest.clearAllMocks()
  })

  test('opens Find/Replace via Cmd+F and via custom event', async () => {
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()
    await openFindReplaceModalWithShortcut()
    expect(screen.getByPlaceholderText(/Search text/i)).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search text/i)).not.toBeInTheDocument()
    })

    await openFindReplaceModalWithEvent()
    expect(screen.getByPlaceholderText(/Search text/i)).toBeInTheDocument()

    // Close so this test leaves modal state clean
    await user.click(screen.getByText(/^ESC$/i))
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search text/i)).not.toBeInTheDocument()
    })
  })

  test('supports debounced search, arrow navigation, whole-word filtering, and clear', async () => {
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()
    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'hell')

    // Wait for debounced search to settle
    await waitForMatchSummary(/1 of 3 matches/i)

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    await waitForMatchSummary(/2 of 3 matches/i)

    await user.click(screen.getByRole('button', { name: /Whole Word/i }))
    await waitForMatchSummary(/0 matches/i)

    await user.click(screen.getByRole('button', { name: /Clear/i }))

    expect(findInput.value).toBe('')
    expect(screen.getByTestId('match-summary')).toHaveTextContent('')
    expect(screen.queryByPlaceholderText(/Replacement/i)).not.toBeInTheDocument()
  })

  test('treats accented letters as word characters in whole-word mode', async () => {
    const user = userEventLib.setup()
    ;(supabaseQueries.fetchTranscriptData as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 'u1', start_ms: 0, end_ms: 3000, text: 'mañana ana', project_id: 'p1', speaker_id: null },
      ],
      source: 'chunks',
    })

    render(<EditorPage params={{ id: 'p1' }} />)

    await screen.findByTestId('audio-player')
    await screen.findByTestId('segment-card')
    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'ana')
    await waitForMatchSummary(/1 of 2 matches/i)

    await user.click(screen.getByRole('button', { name: /Whole Word/i }))
    await waitForMatchSummary(/1 of 1 matches/i)
  })

  test('treats Arabic letters as word characters in whole-word mode', async () => {
    const user = userEventLib.setup()
    ;(supabaseQueries.fetchTranscriptData as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 'u1', start_ms: 0, end_ms: 3000, text: 'مرحبا حب', project_id: 'p1', speaker_id: null },
      ],
      source: 'chunks',
    })

    render(<EditorPage params={{ id: 'p1' }} />)

    await screen.findByTestId('audio-player')
    await screen.findByTestId('segment-card')
    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'حب')
    await waitForMatchSummary(/1 of 2 matches/i)

    await user.click(screen.getByRole('button', { name: /Whole Word/i }))
    await waitForMatchSummary(/1 of 1 matches/i)
  })

  test('disables replace actions while search input is still debouncing', async () => {
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()
    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'hello')
    await waitForMatchSummary(/1 of 3 matches/i)

    const replaceInput = await screen.findByPlaceholderText(/Replacement/i)
    await user.type(replaceInput, 'earth')

    // Change search term; controls should disable until the new term is committed.
    await user.type(findInput, 'z')
    expect(screen.getByTestId('match-summary')).toHaveTextContent(/Searching/i)

    const replaceBtn = screen.getByRole('button', { name: /^Replace$/i })
    const replaceAllBtn = screen.getByRole('button', { name: /Replace all/i })
    expect(replaceBtn).toBeDisabled()
    expect(replaceAllBtn).toBeDisabled()

    await user.click(replaceBtn)
    await user.click(replaceAllBtn)
    expect(supabaseQueries.updateChunk).not.toHaveBeenCalled()

    await waitForMatchSummary(/0 matches/i)
    expect(replaceBtn).toBeDisabled()
    expect(replaceAllBtn).toBeDisabled()
  })

  test('uses Enter to commit new term first, then close on result selection', async () => {
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()
    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'hello')

    // First Enter commits the new term and keeps the modal open.
    fireEvent.keyDown(findInput, { key: 'Enter' })
    expect(screen.getByPlaceholderText(/Search text/i)).toBeInTheDocument()
    await waitForMatchSummary(/1 of 3 matches/i)
    expect(screen.getByPlaceholderText(/Search text/i)).toBeInTheDocument()

    // Second Enter on the committed term selects current result and closes.
    fireEvent.keyDown(findInput, { key: 'Enter' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search text/i)).not.toBeInTheDocument()
    })
  })

  test('keeps Find/Replace open on Enter when committed term has no matches', async () => {
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()
    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'hello')
    await waitForMatchSummary(/1 of 3 matches/i)

    await user.clear(findInput)
    await user.type(findInput, 'zzzz_no_match')
    fireEvent.keyDown(findInput, { key: 'Enter' })

    await waitForMatchSummary(/0 matches/i)
    expect(screen.getByPlaceholderText(/Search text/i)).toBeInTheDocument()
  })

  test('replaces one match and then replaces all remaining matches', async () => {
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()
    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'hello')
    await waitForMatchSummary(/1 of 3 matches/i)

    const replaceInput = await screen.findByPlaceholderText(/Replacement/i)
    await user.type(replaceInput, 'earth')

    await user.click(screen.getByRole('button', { name: /^Replace$/i }))
    await waitFor(() => {
      expect(supabaseQueries.updateChunk).toHaveBeenCalledTimes(1)
    }, { timeout: 1500 })
    await waitForMatchSummary(/of 2 matches/i)

    const replaceAllBtn = screen.getByRole('button', { name: /Replace all/i })
    await user.click(replaceAllBtn)

    await waitFor(() => {
      expect(supabaseQueries.updateChunk).toHaveBeenCalledTimes(3)
    }, { timeout: 1500 })
  })

  test('opens Export modal via custom event and closes with Escape', async () => {
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()

    window.dispatchEvent(new CustomEvent('open-export'))
    await screen.findByText(/Export Transcript/i)
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByText(/Export Transcript/i)).not.toBeInTheDocument()
    })
    expect(document.body.style.overflow).toBe('')
  })

  test('ignores Cmd+F while Export modal is open', async () => {
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()

    window.dispatchEvent(new CustomEvent('open-export'))
    await screen.findByText(/Export Transcript/i)

    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    expect(screen.queryByPlaceholderText(/Search text/i)).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByText(/Export Transcript/i)).not.toBeInTheDocument()
    })
  })

  test('auto-exits segment edit mode when opening Export', async () => {
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()

    const editButtons = screen.getAllByTitle(/Edit text/i)
    await user.click(editButtons[0])
    await waitFor(() => {
      expect(document.querySelector('[data-testid="segment-card"] textarea')).not.toBeNull()
    })

    window.dispatchEvent(new CustomEvent('open-export'))
    await screen.findByText(/Export Transcript/i)

    expect(document.querySelector('[data-testid="segment-card"] textarea')).toBeNull()
  })

  test('auto-exits segment edit mode when opening Find/Replace', async () => {
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()

    const editButtons = screen.getAllByTitle(/Edit text/i)
    await user.click(editButtons[0])
    await waitFor(() => {
      expect(document.querySelector('[data-testid="segment-card"] textarea')).not.toBeNull()
    })

    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    await screen.findByPlaceholderText(/Search text/i)

    expect(document.querySelector('[data-testid="segment-card"] textarea')).toBeNull()
  })

  test('auto-closes speaker popover when opening Find/Replace', async () => {
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    await waitForEditorContent()

    await user.click(screen.getByTitle(/Click to change speaker/i))
    await screen.findByText(/Suggested Speakers/i)

    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    await screen.findByPlaceholderText(/Search text/i)

    expect(screen.queryByText(/Suggested Speakers/i)).not.toBeInTheDocument()
  })
})
