import React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import EditorScreen from '../app/editor/[id]/EditorScreen'
import * as supabaseQueries from '../lib/supabase/queries'
import { scrollToIndexMock, rangeChangedMock } from '../__mocks__/react-virtuoso'

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

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

const mockRect = (
  el: HTMLElement,
  { left = 0, top = 0, width = 0, height = 0 }: { left?: number, top?: number, width?: number, height?: number }
) => {
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => { },
  })
}

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

  const collapseWaveform = async () => {
    const scrollContainer = document.querySelector('.overflow-auto') as HTMLElement
    expect(scrollContainer).not.toBeNull()

    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 80,
    })

    fireEvent.scroll(scrollContainer)

    await waitFor(() => {
      expect(screen.getByRole('slider', { name: 'Audio scrubber' })).toBeInTheDocument()
    })
  }

  const expectActiveSegmentIndex = async (idx: number) => {
    await waitFor(() => {
      const cards = screen.getAllByTestId('segment-card')
      cards.forEach((card, cardIdx) => {
        if (cardIdx === idx) {
          expect(card.className).toContain('bg-trust-blue/10')
        } else {
          expect(card.className).not.toContain('bg-trust-blue/10')
        }
      })
    })
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
    scrollToIndexMock.mockClear()
    rangeChangedMock.mockClear()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('opens Find/Replace via Cmd+F and via custom event', async () => {
    const user = userEventLib.setup()
    render(<EditorScreen projectId="p1" />)

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

  test('reopens the waveform and scrolls to top via the header custom event', async () => {
    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()
    await collapseWaveform()

    const scrollContainer = document.querySelector('.overflow-auto') as HTMLElement
    expect(scrollContainer).not.toBeNull()
    scrollContainer.scrollTo = jest.fn()

    window.dispatchEvent(new CustomEvent('editor-scroll-to-top'))

    await waitFor(() => {
      expect(screen.queryByRole('slider', { name: 'Audio scrubber' })).not.toBeInTheDocument()
    })
    expect(scrollContainer.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })

  test('supports debounced search, arrow navigation, whole-word filtering, and clear', async () => {
    const user = userEventLib.setup()
    render(<EditorScreen projectId="p1" />)

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

    render(<EditorScreen projectId="p1" />)

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

    render(<EditorScreen projectId="p1" />)

    await screen.findByTestId('audio-player')
    await screen.findByTestId('segment-card')
    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'حب')
    await waitForMatchSummary(/1 of 2 matches/i)

    await user.click(screen.getByRole('button', { name: /Whole Word/i }))
    await waitForMatchSummary(/1 of 1 matches/i)
  })

  test('sets audio source before transcript data resolves', async () => {
    const transcriptDeferred = deferred<{
      items: Array<{ id: string; start_ms: number; end_ms: number; text: string; project_id: string; speaker_id: null }>
      source: 'chunks'
    }>()
    ;(supabaseQueries.fetchTranscriptData as jest.Mock).mockReturnValueOnce(transcriptDeferred.promise)

    render(<EditorScreen projectId="p1" />)

    await waitFor(() => {
      expect(screen.getByTestId('audio-player')).toHaveAttribute('data-src', 'http://example.com/audio.mp3')
    })
    expect(screen.queryByTestId('segment-card')).not.toBeInTheDocument()

    await act(async () => {
      transcriptDeferred.resolve({
        items: [
          { id: 's1', start_ms: 0, end_ms: 2000, text: 'hello world. Hello again.', project_id: 'p1', speaker_id: null },
          { id: 's2', start_ms: 2000, end_ms: 4000, text: 'world says hello.', project_id: 'p1', speaker_id: null },
        ],
        source: 'chunks',
      })
    })

    const segmentsRendered = await screen.findAllByTestId('segment-card')
    expect(segmentsRendered.length).toBeGreaterThanOrEqual(2)
  })

  test('sets audio source but renders no segments when transcript fetch fails', async () => {
    ;(supabaseQueries.fetchTranscriptData as jest.Mock).mockRejectedValueOnce(new Error('DB timeout'))

    render(<EditorScreen projectId="p1" />)

    await waitFor(() => {
      expect(screen.getByTestId('audio-player')).toHaveAttribute('data-src', 'http://example.com/audio.mp3')
    })
    await act(async () => {})
    expect(screen.queryByTestId('segment-card')).not.toBeInTheDocument()
  })

  test('shows error status when media URL fetch fails and does not render segments', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes('/media-url')) return makeJsonResponse({}, 500)
      return makeJsonResponse('Not found', 404)
    }) as jest.Mock

    render(<EditorScreen projectId="p1" />)

    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to fetch media URL: 500/)).toBeInTheDocument()
    })
    expect(screen.queryByTestId('segment-card')).not.toBeInTheDocument()
  })

  test('renders segments normally when speakers fetch fails silently', async () => {
    ;(supabaseQueries.fetchSpeakers as jest.Mock).mockRejectedValueOnce(new Error('Network error'))

    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument()
  })

  test('renders segments normally when project metadata fetch fails silently', async () => {
    ;(supabaseQueries.fetchProjectById as jest.Mock).mockRejectedValueOnce(new Error('Network error'))

    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument()
  })

  test('renders without error when transcript returns empty items', async () => {
    ;(supabaseQueries.fetchTranscriptData as jest.Mock).mockResolvedValueOnce({
      items: [],
      source: 'chunks',
    })

    render(<EditorScreen projectId="p1" />)

    await waitFor(() => {
      expect(screen.getByTestId('audio-player')).toHaveAttribute('data-src', 'http://example.com/audio.mp3')
    })
    await act(async () => {})
    expect(screen.queryByTestId('segment-card')).not.toBeInTheDocument()
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument()
  })

  test('disables replace actions while search input is still debouncing', async () => {
    const user = userEventLib.setup()
    render(<EditorScreen projectId="p1" />)

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
    render(<EditorScreen projectId="p1" />)

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
    render(<EditorScreen projectId="p1" />)

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

  test('preserves Find/Replace state when closing and reopening', async () => {
    const user = userEventLib.setup()
    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()
    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'hello')
    await waitForMatchSummary(/1 of 3 matches/i)

    const replaceInput = await screen.findByPlaceholderText(/Replacement/i)
    await user.type(replaceInput, 'earth')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search text/i)).not.toBeInTheDocument()
    })

    await openFindReplaceModalWithShortcut()

    expect(screen.getByDisplayValue('hello')).toBeInTheDocument()
    expect(screen.getByDisplayValue('earth')).toBeInTheDocument()
    await waitForMatchSummary(/1 of 3 matches/i)
  })

  test('replaces one match and then replaces all remaining matches', async () => {
    const user = userEventLib.setup()
    render(<EditorScreen projectId="p1" />)

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
    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()

    window.dispatchEvent(new CustomEvent('open-export'))
    await screen.findByText(/Export Transcript/i)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByText(/Export Transcript/i)).not.toBeInTheDocument()
    })
  })

  test('ignores Cmd+F while Export modal is open', async () => {
    render(<EditorScreen projectId="p1" />)

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
    render(<EditorScreen projectId="p1" />)

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

  test('does not open Export or prevent default for Ctrl+Alt+E while typing', async () => {
    const user = userEventLib.setup()
    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()

    const editButtons = screen.getAllByTitle(/Edit text/i)
    await user.click(editButtons[0])
    const textarea = await waitFor(() => {
      const el = document.querySelector('[data-testid="segment-card"] textarea')
      expect(el).not.toBeNull()
      return el as HTMLTextAreaElement
    })

    const event = new KeyboardEvent('keydown', {
      key: 'e',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault')

    textarea.dispatchEvent(event)

    expect(preventDefaultSpy).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByText(/Export Transcript/i)).not.toBeInTheDocument()
  })

  test('auto-exits segment edit mode when opening Find/Replace', async () => {
    const user = userEventLib.setup()
    render(<EditorScreen projectId="p1" />)

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
    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()

    await user.click(screen.getByTitle(/Click to change speaker/i))
    await screen.findByText(/Suggested Speakers/i)

    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    await screen.findByPlaceholderText(/Search text/i)

    expect(screen.queryByText(/Suggested Speakers/i)).not.toBeInTheDocument()
  })

  test('persistent search does not steal edit-mode focus after follow is resumed', async () => {
    const user = userEventLib.setup()
    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()

    const cards = screen.getAllByTestId('segment-card')
    fireEvent.click(cards[0])
    await expectActiveSegmentIndex(0)

    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i)
    await user.type(findInput, 'hell')
    await waitForMatchSummary(/1 of 3 matches/i)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search text/i)).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /sync to audio/i }))
    scrollToIndexMock.mockClear()

    const editButtons = screen.getAllByTitle(/Edit text/i)
    await user.click(editButtons[1])

    await waitFor(() => {
      expect(document.querySelector('[data-testid="segment-card"] textarea')).not.toBeNull()
    })
    expect(scrollToIndexMock).not.toHaveBeenCalled()
  })

  test('search keeps the sync button visible after a manual scroll with no active segment', async () => {
    const user = userEventLib.setup()
    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()

    const scrollContainer = document.querySelector('.overflow-auto') as HTMLElement
    expect(scrollContainer).not.toBeNull()
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 120,
    })

    fireEvent.wheel(scrollContainer)
    fireEvent.scroll(scrollContainer)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sync to audio/i })).toBeInTheDocument()
    })

    await openFindReplaceModalWithShortcut()

    const findInput = screen.getByPlaceholderText(/Search text/i)
    await user.type(findInput, 'hello')
    await waitForMatchSummary(/1 of 3 matches/i)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search text/i)).not.toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /sync to audio/i })).toBeInTheDocument()
  })

  test('scrubbing while follow mode is active does not show the sync button', async () => {
    render(<EditorScreen projectId="p1" />)

    await waitForEditorContent()
    await collapseWaveform()

    const cards = screen.getAllByTestId('segment-card')
    fireEvent.click(cards[0])
    await expectActiveSegmentIndex(0)

    expect(screen.queryByRole('button', { name: /sync to audio/i })).not.toBeInTheDocument()

    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    mockRect(slider, { left: 0, width: 200, height: 6 })
    fireEvent.mouseDown(slider, { clientX: 10 })

    expect(screen.queryByRole('button', { name: /sync to audio/i })).not.toBeInTheDocument()
  })

  test('scrub follow uses viewport visibility instead of visible range heuristics', async () => {
    const user = userEventLib.setup()
    ;(supabaseQueries.fetchTranscriptData as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 's1', start_ms: 0, end_ms: 2000, text: 'one', project_id: 'p1', speaker_id: null },
        { id: 's2', start_ms: 2000, end_ms: 4000, text: 'two', project_id: 'p1', speaker_id: null },
        { id: 's3', start_ms: 4000, end_ms: 6000, text: 'three', project_id: 'p1', speaker_id: null },
      ],
      source: 'chunks',
    })

    render(<EditorScreen projectId="p1" />)
    await waitForEditorContent()
    await collapseWaveform()

    const cards = screen.getAllByTestId('segment-card')
    const scrollContainer = cards[0].closest('.overflow-auto') as HTMLElement

    jest.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 300,
      left: 0,
      right: 300,
      width: 300,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => { },
    })

    jest.spyOn(cards[0], 'getBoundingClientRect').mockReturnValue({
      top: 40,
      bottom: 140,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
      x: 0,
      y: 40,
      toJSON: () => { },
    })
    jest.spyOn(cards[1], 'getBoundingClientRect').mockReturnValue({
      top: -20,
      bottom: 80,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
      x: 0,
      y: -20,
      toJSON: () => { },
    })
    jest.spyOn(cards[2], 'getBoundingClientRect').mockReturnValue({
      top: 500,
      bottom: 600,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
      x: 0,
      y: 500,
      toJSON: () => { },
    })

    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    mockRect(slider, { left: 0, width: 200, height: 6 })
    fireEvent.mouseDown(slider, { clientX: 1 })

    await act(async () => {
      fireEvent.mouseMove(window, { clientX: 10 })
    })

    expect(scrollToIndexMock).toHaveBeenCalledWith(expect.objectContaining({
      index: 1,
      behavior: 'auto',
    }))

    scrollToIndexMock.mockClear()

    await act(async () => {
      fireEvent.mouseMove(window, { clientX: 1 })
    })

    expect(scrollToIndexMock).not.toHaveBeenCalled()

    fireEvent.mouseUp(window)
  })

  test('mini scrub clears transcript click lock before previewing a new segment', async () => {
    ;(supabaseQueries.fetchTranscriptData as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 's1', start_ms: 0, end_ms: 2000, text: 'one', project_id: 'p1', speaker_id: null },
        { id: 's2', start_ms: 2000, end_ms: 4000, text: 'two', project_id: 'p1', speaker_id: null },
        { id: 's3', start_ms: 4000, end_ms: 6000, text: 'three', project_id: 'p1', speaker_id: null },
      ],
      source: 'chunks',
    })

    render(<EditorScreen projectId="p1" />)
    await waitForEditorContent()
    await collapseWaveform()

    const cards = screen.getAllByTestId('segment-card')
    fireEvent.click(cards[2])
    await expectActiveSegmentIndex(2)

    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    mockRect(slider, { left: 0, width: 200, height: 6 })
    fireEvent.mouseDown(slider, { clientX: 3 })

    await expectActiveSegmentIndex(0)

    fireEvent.mouseUp(window)
  })

  test('scrub end performs a final follow correction even when the active segment does not change', async () => {
    ;(supabaseQueries.fetchTranscriptData as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 's1', start_ms: 0, end_ms: 2000, text: 'one', project_id: 'p1', speaker_id: null },
        { id: 's2', start_ms: 2000, end_ms: 4000, text: 'two', project_id: 'p1', speaker_id: null },
      ],
      source: 'chunks',
    })

    render(<EditorScreen projectId="p1" />)
    await waitForEditorContent()
    await collapseWaveform()

    const cards = screen.getAllByTestId('segment-card')
    const scrollContainer = cards[0].closest('.overflow-auto') as HTMLElement

    jest.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 300,
      left: 0,
      right: 300,
      width: 300,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => { },
    })

    jest.spyOn(cards[0], 'getBoundingClientRect').mockReturnValue({
      top: 40,
      bottom: 140,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
      x: 0,
      y: 40,
      toJSON: () => { },
    })
    jest.spyOn(cards[1], 'getBoundingClientRect').mockReturnValue({
      top: -10,
      bottom: 90,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
      x: 0,
      y: -10,
      toJSON: () => { },
    })

    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    mockRect(slider, { left: 0, width: 200, height: 6 })
    fireEvent.mouseDown(slider, { clientX: 10 })
    scrollToIndexMock.mockClear()

    await act(async () => {
      fireEvent.mouseUp(window)
    })

    expect(scrollToIndexMock).toHaveBeenCalledWith(expect.objectContaining({
      index: 1,
      behavior: 'auto',
    }))
  })

  test('active segment lookup stays on the earliest overlapping segment', async () => {
    ;(supabaseQueries.fetchTranscriptData as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 's1', start_ms: 0, end_ms: 10000, text: 'long', project_id: 'p1', speaker_id: null },
        { id: 's2', start_ms: 2000, end_ms: 3000, text: 'short one', project_id: 'p1', speaker_id: null },
        { id: 's3', start_ms: 4000, end_ms: 5000, text: 'short two', project_id: 'p1', speaker_id: null },
      ],
      source: 'chunks',
    })

    render(<EditorScreen projectId="p1" />)
    await waitForEditorContent()
    await collapseWaveform()

    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    mockRect(slider, { left: 0, width: 200, height: 6 })

    fireEvent.mouseDown(slider, { clientX: 15 })

    await expectActiveSegmentIndex(0)

    fireEvent.mouseUp(window)
  })
})
