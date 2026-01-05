import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import EditorPage from '../app/editor/[id]/page'

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
    if (url.includes('/segments') && method === 'GET') {
      const segs = [
        { id: 's1', start_ms: 0, end_ms: 2000, text: 'hello world. Hello again.' },
        { id: 's2', start_ms: 2000, end_ms: 4000, text: 'world says hello.' },
      ]
      return makeJsonResponse(segs)
    }
    if (url.includes('/segments/') && init?.method === 'PATCH') {
      return makeJsonResponse({}, 200)
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
  })

  test('search commit flow via Search button', async () => {
    const fetchSpy = mockFetch()
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    // Wait for page and segments to load
    await screen.findByText(/Editor: p1/i)
    const segmentsRendered = await screen.findAllByTestId('segment-card')
    expect(segmentsRendered.length).toBeGreaterThanOrEqual(2)

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'world')

    // Should prompt to press Search and disable navigation until committed
    expect(screen.getByText(/Press Search/i)).toBeInTheDocument()

    const searchBtn = screen.getByRole('button', { name: /Search/i })
    await user.click(searchBtn)

    const summary = await screen.findByTestId('match-summary')
    await waitFor(() => {
      expect(summary.textContent).toMatch(/(\d+\/\d+)|0 matches/i)
    })
    const prevBtn = screen.getByRole('button', { name: /Prev/i })
    const nextBtn = screen.getByRole('button', { name: /Next/i })
    expect(prevBtn).toBeEnabled()
    expect(nextBtn).toBeEnabled()

    // Replace current match and ensure debounce save fires
    const replaceBtn = screen.getByRole('button', { name: /Replace$/i })
    await user.click(replaceBtn)
    await waitFor(() => {
      const patchCalls = (fetchSpy as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('/segments/') && c[1]?.method === 'PATCH')
      expect(patchCalls.length).toBeGreaterThanOrEqual(1)
    }, { timeout: 1500 })
  })

  test('replace all patches all occurrences across segments', async () => {
    const fetchSpy = mockFetch()
    const user = userEventLib.setup()
    render(<EditorPage params={{ id: 'p1' }} />)

    // Wait for UI header present
    await screen.findByText(/Editor: p1/i)
    const segmentCards = await screen.findAllByTestId('segment-card')
    expect(segmentCards.length).toBeGreaterThanOrEqual(2)

    const findInput = screen.getByPlaceholderText(/Search text/i) as HTMLInputElement
    await user.type(findInput, 'hello')
    await user.click(screen.getByRole('button', { name: /Search/i }))

    const replaceInput = screen.getByPlaceholderText(/Replacement/i)
    await user.clear(replaceInput)
    await user.type(replaceInput, 'earth')
    const replaceAllBtn = screen.getByRole('button', { name: /Replace all/i })
    await user.click(replaceAllBtn)

    await waitFor(() => {
      const patchCalls = (fetchSpy as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('/segments/') && c[1]?.method === 'PATCH')
      expect(patchCalls.length).toBeGreaterThanOrEqual(2)
    }, { timeout: 1500 })
  })
})
