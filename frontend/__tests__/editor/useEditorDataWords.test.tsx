import { act, renderHook, waitFor } from '@testing-library/react'
import * as supabaseQueries from '@/lib/supabase/queries'
import { useEditorData } from '@/app/editor/[id]/hooks/useEditorData'

const mockToast = jest.fn()
jest.mock('@/components/ui/toaster', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

const fetchTranscriptWords = supabaseQueries.fetchTranscriptWords as jest.Mock
const fetchTranscriptData = supabaseQueries.fetchTranscriptData as jest.Mock

const SEG = '11111111-1111-4111-8111-111111111111'
const word = (order_index: number, text: string, start_ms: number, end_ms: number) => ({
  id: `00000000-0000-4000-8000-${String(order_index + 1).padStart(12, '0')}`,
  segment_id: SEG,
  start_ms,
  end_ms,
  text,
  punctuated_text: null,
  order_index,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'https://media.test/a.webm' }) })) as unknown as typeof fetch
  mockToast.mockClear()
  fetchTranscriptWords.mockReset()
})

it('loads the words grouped per segment', async () => {
  fetchTranscriptWords.mockResolvedValue([word(1, 'world', 300, 600), word(0, 'hello', 0, 300)])
  const { result } = renderHook(() => useEditorData('t1'))

  await waitFor(() => expect(result.current.wordsBySegment.get(SEG)).toBeDefined())
  expect(result.current.wordsBySegment.get(SEG)).toEqual([
    { text: 'hello', startMs: 0, endMs: 300 },
    { text: 'world', startMs: 300, endMs: 600 },
  ])
  expect(fetchTranscriptWords).toHaveBeenCalledWith('t1')
})

it('shows segments without waiting for the words', async () => {
  fetchTranscriptWords.mockReturnValue(new Promise(() => {}))
  const { result } = renderHook(() => useEditorData('t1'))

  await waitFor(() => expect(result.current.segments).toHaveLength(2))
  expect(result.current.wordsBySegment.size).toBe(0)
})

it('reports a failed load with Retry and keeps the even-spacing fallback', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {})
  fetchTranscriptWords.mockRejectedValueOnce(new Error('permission denied for table words'))
  const { result } = renderHook(() => useEditorData('t1'))

  await waitFor(() => expect(mockToast).toHaveBeenCalled())
  const toast = mockToast.mock.calls[0][0]
  expect(toast).toMatchObject({ title: "Couldn't load word timings", variant: 'error' })
  expect(result.current.wordsBySegment.size).toBe(0)
  await waitFor(() => expect(result.current.segments).toHaveLength(2))

  fetchTranscriptWords.mockResolvedValueOnce([word(0, 'hello', 0, 300)])
  act(() => toast.action.onClick())
  await waitFor(() => expect(result.current.wordsBySegment.get(SEG)).toHaveLength(1))
  error.mockRestore()
})

it('turns a synchronous throw into the same reported failure', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {})
  fetchTranscriptWords.mockImplementationOnce(() => { throw new Error('boom') })
  const { result } = renderHook(() => useEditorData('t1'))

  await waitFor(() => expect(mockToast).toHaveBeenCalled())
  await waitFor(() => expect(result.current.segments).toHaveLength(2))
  expect(result.current.status).not.toMatch(/^Error/)
  error.mockRestore()
})

it('discards words that arrive after the transcript changed', async () => {
  const first = deferred<unknown[]>()
  const second = deferred<unknown[]>()
  fetchTranscriptWords.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  fetchTranscriptData.mockResolvedValue({ items: [] })

  const { result, rerender } = renderHook(({ id }) => useEditorData(id), { initialProps: { id: 't1' } })
  await waitFor(() => expect(fetchTranscriptWords).toHaveBeenCalledWith('t1'))
  rerender({ id: 't2' })
  await waitFor(() => expect(fetchTranscriptWords).toHaveBeenCalledWith('t2'))

  await act(async () => { first.resolve([word(0, 'stale', 0, 100)]) })
  expect(result.current.wordsBySegment.size).toBe(0)

  await act(async () => { second.resolve([word(0, 'fresh', 0, 100)]) })
  expect(result.current.wordsBySegment.get(SEG)).toEqual([{ text: 'fresh', startMs: 0, endMs: 100 }])
})
