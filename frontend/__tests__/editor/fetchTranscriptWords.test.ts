/** @jest-environment node */

// Marks the file as a module, so the mock names do not collide with other files.
export {}

type Call = [method: string, ...args: unknown[]]

const mockCalls: Call[] = []
let mockRows: Array<{ id: string; order_index: number }> = []

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
const { fetchTranscriptWords } = jest.requireActual<typeof import('@/lib/supabase/queries')>('@/lib/supabase/queries')

beforeEach(() => {
  mockCalls.length = 0
})

test('pages past the 1,000-row cap and returns every word in order', async () => {
  mockRows = Array.from({ length: 2345 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    order_index: i,
  }))

  const rows = await fetchTranscriptWords('t1')

  expect(rows).toHaveLength(2345)
  expect(rows.map((r) => r.order_index)).toEqual(mockRows.map((r) => r.order_index))
  expect(mockCalls.filter(([m]) => m === 'range')).toEqual([
    ['range', 0, 999],
    ['range', 1000, 1999],
    ['range', 2000, 2999],
  ])
})

test('filters by transcript through segments without returning segment columns', async () => {
  mockRows = []
  await fetchTranscriptWords('t1')

  expect(mockCalls).toEqual([
    ['from', 'words'],
    ['select', 'id, segment_id, start_ms, end_ms, text, punctuated_text, order_index, segments!inner()'],
    ['eq', 'segments.transcript_id', 't1'],
    ['order', 'segment_id', { ascending: true }],
    ['order', 'order_index', { ascending: true }],
    ['order', 'id', { ascending: true }],
    ['range', 0, 999],
  ])
})
