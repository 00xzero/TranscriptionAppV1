/** @jest-environment node */

// Marks the file as a module, so `mockRpc` does not collide with other test
// files that declare the same name.
export {}

const mockRpc = jest.fn()
const mockFrom = jest.fn()
jest.mock('@/infra/supabase/client', () => ({ createClient: () => ({ rpc: mockRpc, from: mockFrom }) }))

// jest.setup.ts globally mocks this module, so reach past it for the real code.
const {
  addTranscriptTag, createTranscriptTag, deleteTag, fetchTags, fetchTranscriptTags, mergeTags,
  removeTranscriptTag, renameTag, setTagColor, undoCreatedTag,
} = jest.requireActual<typeof import('@/lib/supabase/queries')>('@/lib/supabase/queries')

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const tagId = id('1')
const otherId = id('2')
const transcriptId = id('3')
const userId = id('4')
const stamp = '2026-11-01T00:00:00+00:00'
const tag = { id: tagId, user_id: userId, name: 'Interview', color: '#4F638C', created_at: stamp, updated_at: stamp }

beforeEach(() => {
  mockRpc.mockReset()
  mockFrom.mockReset()
})

// A query builder whose pages come from `pages`, one per range() call.
type PagedTable = { select: jest.Mock; order: jest.Mock; range: jest.Mock }

function pagedTable(pages: unknown[][]): PagedTable {
  let page = 0
  const builder: PagedTable = {
    select: jest.fn((): PagedTable => builder),
    order: jest.fn((): PagedTable => builder),
    range: jest.fn(() => Promise.resolve({ data: pages[page++] ?? [], error: null })),
  }
  return builder
}

test('reads every tag and every link, paging past 1,000 rows and validating them', async () => {
  // Each page asks for the table again.
  mockFrom.mockReturnValue(pagedTable([[tag]]))
  await expect(fetchTags()).resolves.toEqual([tag])
  expect(mockFrom).toHaveBeenLastCalledWith('tags')

  const page = Array.from({ length: 1000 }, (_, index) => ({
    transcript_id: transcriptId, tag_id: `${index.toString().padStart(8, '0')}-0000-4000-8000-000000000000` }))
  const table = pagedTable([page, [{ transcript_id: transcriptId, tag_id: tagId }]])
  mockFrom.mockReturnValue(table)
  await expect(fetchTranscriptTags()).resolves.toHaveLength(1001)
  expect(mockFrom).toHaveBeenLastCalledWith('transcript_tags')
  expect(table.range).toHaveBeenNthCalledWith(2, 1000, 1999)

  mockFrom.mockReturnValue(pagedTable([[{ ...tag, color: 7 }]]))
  await expect(fetchTags()).rejects.toThrow()
})

test('links and unlinks name the transcript and the tag', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null })
  await addTranscriptTag(transcriptId, tagId)
  expect(mockRpc).toHaveBeenLastCalledWith('add_transcript_tag', { p_transcript_id: transcriptId, p_tag_id: tagId })
  await removeTranscriptTag(transcriptId, tagId)
  expect(mockRpc).toHaveBeenLastCalledWith('remove_transcript_tag', { p_transcript_id: transcriptId, p_tag_id: tagId })
})

test('create sends the chosen id, name and colour, and reads back the outcome', async () => {
  mockRpc.mockResolvedValue({ data: { tag, outcome: 'own' }, error: null })
  await expect(createTranscriptTag(transcriptId, tagId, 'Interview', '#4F638C')).resolves.toEqual({ tag, outcome: 'own' })
  expect(mockRpc).toHaveBeenLastCalledWith('create_transcript_tag', {
    p_transcript_id: transcriptId, p_tag_id: tagId, p_name: 'Interview', p_color: '#4F638C' })

  mockRpc.mockResolvedValue({ data: { tag, outcome: 'maybe' }, error: null })
  await expect(createTranscriptTag(transcriptId, tagId, 'Interview', '#4F638C')).rejects.toThrow()

  mockRpc.mockResolvedValue({ data: 'kept', error: null })
  await expect(undoCreatedTag(transcriptId, tagId)).resolves.toBe('kept')
  expect(mockRpc).toHaveBeenLastCalledWith('undo_created_tag', { p_transcript_id: transcriptId, p_tag_id: tagId })
})

test('tag-level writes send what they expect to replace', async () => {
  mockRpc.mockResolvedValue({ data: { ...tag, name: 'Calls' }, error: null })
  await renameTag(tagId, 'Interview', 'Calls')
  expect(mockRpc).toHaveBeenLastCalledWith('rename_tag', { p_tag_id: tagId, p_expected_name: 'Interview', p_name: 'Calls' })

  mockRpc.mockResolvedValue({ data: { ...tag, color: '#0D9488' }, error: null })
  await setTagColor(tagId, '#4F638C', '#0D9488')
  expect(mockRpc).toHaveBeenLastCalledWith('set_tag_color', {
    p_tag_id: tagId, p_expected_color: '#4F638C', p_color: '#0D9488' })

  mockRpc.mockResolvedValue({ data: false, error: null })
  await expect(deleteTag(tagId)).resolves.toBe(false)
  expect(mockRpc).toHaveBeenLastCalledWith('delete_tag', { p_tag_id: tagId })

  mockRpc.mockResolvedValue({ data: { tag, merged: true }, error: null })
  await expect(mergeTags(otherId, tagId)).resolves.toEqual({ tag, merged: true })
  expect(mockRpc).toHaveBeenLastCalledWith('merge_tags', { p_from: otherId, p_into: tagId })

  const refusal = { code: 'SP002', message: 'changed' }
  mockRpc.mockResolvedValue({ data: null, error: refusal })
  await expect(renameTag(tagId, 'Old', 'New')).rejects.toBe(refusal)
})
