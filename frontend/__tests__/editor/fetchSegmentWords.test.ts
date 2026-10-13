/** @jest-environment node */

// Marks the file as a module, so the mock names do not collide with other files.
export {}

type Call = [method: string, ...args: unknown[]]

const mockCalls: Call[] = []
let mockRows: Array<{ id: string; revision: number; words: unknown[] }> = []

// A chainable stand-in for the PostgREST builder that records every call and
// serves `range(from, to)` slices of mockRows.
function mockBuilder() {
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  for (const method of ['from', 'select', 'eq', 'order']) {
    builder[method] = (...args: unknown[]) => {
      mockCalls.push([method, ...args])
      return builder
    }
  }
  builder.range = (from: unknown, to: unknown) => {
    mockCalls.push(['range', from, to])
    return Promise.resolve({ data: mockRows.slice(from as number, (to as number) + 1), error: null })
  }
  return builder
}

jest.mock('@/infra/supabase/client', () => ({ createClient: () => mockBuilder() }))

// jest.setup.ts globally mocks this module, so reach past it for the real code.
const { fetchSegmentWordSets, fetchSegmentsWithWords } =
  jest.requireActual<typeof import('@/lib/supabase/queries')>('@/lib/supabase/queries')

const WORD_COLUMNS = 'id, segment_id, start_ms, end_ms, text, punctuated_text, order_index'

beforeEach(() => {
  mockCalls.length = 0
})

test('pages through segments, each with all its words, past the 1,000-row cap', async () => {
  mockRows = Array.from({ length: 2345 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    revision: i % 3,
    words: [{ id: `w${i}` }],
  }))

  const sets = await fetchSegmentWordSets('t1')

  expect(sets).toHaveLength(2345)
  expect(sets[2344]).toEqual(mockRows[2344])
  expect(mockCalls.filter(([m]) => m === 'range')).toEqual([
    ['range', 0, 999],
    ['range', 1000, 1999],
    ['range', 2000, 2999],
  ])
})

test("reads each segment's words in the same query as its revision", async () => {
  mockRows = []
  await fetchSegmentWordSets('t1')

  expect(mockCalls).toEqual([
    ['from', 'segments'],
    ['select', `id, revision, words(${WORD_COLUMNS})`],
    ['eq', 'transcript_id', 't1'],
    ['order', 'start_ms', { ascending: true }],
    ['order', 'id', { ascending: true }],
    ['range', 0, 999],
  ])
})

test('reloads whole segments with their words in the same row', async () => {
  mockRows = []
  await fetchSegmentsWithWords('t1')

  expect(mockCalls).toEqual([
    ['from', 'segments'],
    ['select', `*, words(${WORD_COLUMNS})`],
    ['eq', 'transcript_id', 't1'],
    ['order', 'start_ms', { ascending: true }],
    ['order', 'id', { ascending: true }],
    ['range', 0, 999],
  ])
})
