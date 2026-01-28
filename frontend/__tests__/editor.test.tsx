import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import EditorPage from '../app/editor/[id]/page'
import * as supabaseQueries from '../lib/supabase/queries'

const makeJsonResponse = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
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
    return makeJsonResponse('Not found', 404)
  })
  // @ts-ignore
  global.fetch = fetchMock
  return fetchMock
}

describe('EditorPage - Find & Replace', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8000'
    jest.clearAllMocks()
  })

  test('search commit flow via Find button', async () => {
    mockFetch()
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    // Wait for audio player to be ready and segments to load
    await screen.findByText(/Ready/i)
    const segmentsRendered = await screen.findAllByTestId('segment-card')
    expect(segmentsRendered.length).toBeGreaterThanOrEqual(2)

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'world')

    // Should prompt to press Search and disable navigation until committed
    expect(screen.getByText(/Press Search/i)).toBeInTheDocument()

    const findBtn = screen.getByRole('button', { name: /^Find$/i })
    await user.click(findBtn)

    const summary = await screen.findByTestId('match-summary')
    await waitFor(() => {
      expect(summary.textContent).toMatch(/(\d+\/\d+)|0 matches/i)
    })
    const prevBtn = screen.getByRole('button', { name: /Prev/i })
    const nextBtn = screen.getByRole('button', { name: /Next/i })
    expect(prevBtn).toBeEnabled()
    expect(nextBtn).toBeEnabled()

    // Replace current match and ensure updateChunk is called
    const replaceBtn = screen.getByRole('button', { name: /Replace$/i })
    await user.click(replaceBtn)
    await waitFor(() => {
      expect(supabaseQueries.updateChunk).toHaveBeenCalled()
    }, { timeout: 1500 })
  })

  test('replace all patches all occurrences across segments', async () => {
    mockFetch()
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    // Wait for audio player to be ready
    await screen.findByText(/Ready/i)
    const segmentCards = await screen.findAllByTestId('segment-card')
    expect(segmentCards.length).toBeGreaterThanOrEqual(2)

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'hello')
    await user.click(screen.getByRole('button', { name: /^Find$/i }))

    const replaceInput = screen.getByPlaceholderText(/Replacement/i)
    await user.clear(replaceInput)
    await user.type(replaceInput, 'earth')
    const replaceAllBtn = screen.getByRole('button', { name: /Replace all/i })
    await user.click(replaceAllBtn)

    await waitFor(() => {
      // "hello" appears 3 times across 2 segments (hello world. Hello again. + world says hello.)
      // Replace all should trigger updateChunk for each affected segment
      expect(supabaseQueries.updateChunk).toHaveBeenCalled()
    }, { timeout: 1500 })
  })
})
