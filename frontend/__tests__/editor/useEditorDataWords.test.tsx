import { act, renderHook, waitFor } from '@testing-library/react'
import * as supabaseQueries from '@/lib/supabase/queries'
import { useEditorData } from '@/app/editor/[id]/hooks/useEditorData'

const mockToast = jest.fn()
jest.mock('@/components/ui/toaster', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

const fetchSegmentWordSets = supabaseQueries.fetchSegmentWordSets as jest.Mock
const fetchTranscriptData = supabaseQueries.fetchTranscriptData as jest.Mock

const SEG = '11111111-1111-4111-8111-111111111111'
const SEG_B = '22222222-2222-4222-8222-222222222222'
const segment = (id: string, revision: number) => ({
  id, transcript_id: 't1', speaker_id: null, diarization_index: null, start_ms: 0, end_ms: 1000, text: 'hello world',
  is_edited: false, is_filler: false, algo_version: 'test', revision,
  created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
})
const word = (order_index: number, text: string, start_ms: number, end_ms: number, segment_id = SEG) => ({
  id: `00000000-0000-4000-8000-${String(order_index + 1).padStart(12, '0')}`,
  segment_id,
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

let reloadContent: jest.Mock
const render = (id = 't1') => renderHook(({ transcriptId }) => useEditorData(transcriptId, reloadContent), {
  initialProps: { transcriptId: id },
})

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'https://media.test/a.webm' }) })) as unknown as typeof fetch
  mockToast.mockClear()
  reloadContent = jest.fn()
  fetchSegmentWordSets.mockReset()
  fetchTranscriptData.mockResolvedValue({ items: [segment(SEG, 0)] })
})

it('loads the words grouped per segment', async () => {
  fetchSegmentWordSets.mockResolvedValue([{ id: SEG, revision: 0, words: [word(1, 'world', 300, 600), word(0, 'hello', 0, 300)] }])
  const { result } = render()

  await waitFor(() => expect(result.current.wordsBySegment.get(SEG)).toBeDefined())
  expect(result.current.wordsBySegment.get(SEG)).toEqual([
    { id: word(0, '', 0, 0).id, text: 'hello', startMs: 0, endMs: 300 },
    { id: word(1, '', 0, 0).id, text: 'world', startMs: 300, endMs: 600 },
  ])
  expect(fetchSegmentWordSets).toHaveBeenCalledWith('t1')
  expect(reloadContent).not.toHaveBeenCalled()
})

// Codex: a split elsewhere between reading the segments and their words must
// not pair a segment with words from another revision.
it('does not use words read at another revision; it reloads segments and words together', async () => {
  // The segment was shown at revision 0; by the time its words were read,
  // another tab had split it (revision 1, a new second half).
  fetchSegmentWordSets.mockResolvedValue([
    { id: SEG, revision: 1, words: [word(0, 'hello', 0, 300)] },
    { id: SEG_B, revision: 0, words: [word(1, 'world', 300, 600, SEG_B)] },
  ])
  const { result } = render()

  await waitFor(() => expect(reloadContent).toHaveBeenCalledTimes(1))
  expect(result.current.wordsBySegment.size).toBe(0)
})

// CodeRabbit: a slow first load must not overwrite newer words a reload stored.
it('keeps words stored while the first load was in flight', async () => {
  const late = deferred<unknown[]>()
  fetchSegmentWordSets.mockReturnValue(late.promise)
  const { result } = render()
  await waitFor(() => expect(result.current.segments).toHaveLength(1))

  // A reload stores the words of a newer shape first.
  const newer = new Map([[SEG, [{ id: word(0, '', 0, 0).id, text: 'newer', startMs: 0, endMs: 300 }]]])
  act(() => result.current.setWordsBySegment(newer))

  // The first load lands later, still in step with the segments it saw.
  await act(async () => { late.resolve([{ id: SEG, revision: 0, words: [word(0, 'older', 0, 300)] }]) })
  expect(result.current.wordsBySegment).toBe(newer)
  expect(reloadContent).not.toHaveBeenCalled()
})

it('waits for the segments before judging words that arrive first', async () => {
  const data = deferred<{ items: unknown[] }>()
  fetchTranscriptData.mockReturnValue(data.promise)
  fetchSegmentWordSets.mockResolvedValue([{ id: SEG, revision: 0, words: [word(0, 'hello', 0, 300)] }])
  const { result } = render()

  await act(async () => { data.resolve({ items: [segment(SEG, 0)] }) })
  await waitFor(() => expect(result.current.wordsBySegment.get(SEG)).toHaveLength(1))
  expect(reloadContent).not.toHaveBeenCalled()
})

it('shows segments without waiting for the words', async () => {
  fetchSegmentWordSets.mockReturnValue(new Promise(() => {}))
  const { result } = render()

  await waitFor(() => expect(result.current.segments).toHaveLength(1))
  expect(result.current.wordsBySegment.size).toBe(0)
})

it('reports a failed load, keeps the even-spacing fallback, and retries with a reload of both', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {})
  fetchSegmentWordSets.mockRejectedValueOnce(new Error('permission denied for table words'))
  const { result } = render()

  await waitFor(() => expect(mockToast).toHaveBeenCalled())
  const toast = mockToast.mock.calls[0][0]
  expect(toast).toMatchObject({ title: "Couldn't load word timings", variant: 'error' })
  expect(result.current.wordsBySegment.size).toBe(0)
  await waitFor(() => expect(result.current.segments).toHaveLength(1))

  act(() => toast.action.onClick())
  expect(reloadContent).toHaveBeenCalledTimes(1)
  error.mockRestore()
})

it('turns a synchronous throw into the same reported failure', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {})
  fetchSegmentWordSets.mockImplementationOnce(() => { throw new Error('boom') })
  const { result } = render()

  await waitFor(() => expect(mockToast).toHaveBeenCalled())
  await waitFor(() => expect(result.current.segments).toHaveLength(1))
  expect(result.current.status).not.toMatch(/^Error/)
  error.mockRestore()
})

it('discards words that arrive after the transcript changed', async () => {
  const first = deferred<unknown[]>()
  const second = deferred<unknown[]>()
  fetchSegmentWordSets.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

  const { result, rerender } = render('t1')
  await waitFor(() => expect(fetchSegmentWordSets).toHaveBeenCalledWith('t1'))
  rerender({ transcriptId: 't2' })
  await waitFor(() => expect(fetchSegmentWordSets).toHaveBeenCalledWith('t2'))

  await act(async () => { first.resolve([{ id: SEG, revision: 0, words: [word(0, 'stale', 0, 100)] }]) })
  expect(result.current.wordsBySegment.size).toBe(0)

  await act(async () => { second.resolve([{ id: SEG, revision: 0, words: [word(0, 'fresh', 0, 100)] }]) })
  await waitFor(() => expect(result.current.wordsBySegment.get(SEG)).toMatchObject([{ text: 'fresh', startMs: 0, endMs: 100 }]))
})
