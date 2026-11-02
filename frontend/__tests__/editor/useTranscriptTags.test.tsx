import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useEditorHistory } from '@/app/(app)/editor/[id]/hooks/useEditorHistory'
import { useEditorWriteQueue } from '@/app/(app)/editor/[id]/hooks/useEditorWriteQueue'
import { useSegmentHolds } from '@/app/(app)/editor/[id]/hooks/useSegmentHolds'
import { keptToast, useTranscriptTags } from '@/app/(app)/editor/[id]/hooks/useTranscriptTags'
import { toast } from '@/components/ui/toaster'
import type { Tag } from '@/contracts/db'
import type { Send } from '@/lib/editor/untilAnswered'
import { isUncertainOutcome } from '@/lib/people/errors'
import {
  addTranscriptTag,
  createTranscriptTag,
  fetchTags,
  fetchTranscriptTags,
  removeTranscriptTag,
  undoCreatedTag,
} from '@/lib/supabase/queries'
import { TagsProvider, useTags } from '@/lib/tags/TagsProvider'

jest.mock('@/components/ui/toaster', () => ({ toast: jest.fn() }))
jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useTranscriptsData: () => ({ transcripts: [{ id: 't1' }, { id: 't2' }] }),
}))

const tag = (id: string, name: string, color = '#4F638C'): Tag => ({
  id, user_id: 'u1', name, color, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
})
const INTERVIEW = tag('g1', 'Interview')
const LOST = { code: '', message: 'Failed to fetch' }

// Resends once when the answer was lost, as the editor's sender does until answered.
const resend: Send = async (call) => {
  try {
    return await call()
  } catch (error) {
    if (isUncertainOutcome(error)) return call()
    throw error
  }
}

function useHarness() {
  const enqueue = useEditorWriteQueue()
  const holds = useSegmentHolds()
  const history = useEditorHistory({
    enqueue, holds, reveal: () => {}, refresh: async () => true, isReconnecting: () => false, reconnecting: false,
  })
  const tags = useTranscriptTags({ transcriptId: 't1', send: resend, history, holds })
  const store = useTags()
  return { history, tags, store }
}

const wrapper = ({ children }: { children: ReactNode }) => <TagsProvider>{children}</TagsProvider>

async function setUp() {
  const hook = renderHook(() => useHarness(), { wrapper })
  await waitFor(() => expect(hook.result.current.store.ready).toBe(true))
  return hook
}

type Hook = Awaited<ReturnType<typeof setUp>>
const on = (hook: Hook) => hook.result.current.tags.tags.map((entry) => entry.name)
const settled = (hook: Hook) => waitFor(() => expect(hook.result.current.tags.blocked).toBe(false))

// A created tag as the database answers it.
const answer = (id: string, name: string, color: string, outcome: 'own' | 'adopted' | 'created') =>
  ({ tag: tag(id, name, color), outcome })

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(fetchTags).mockResolvedValue([INTERVIEW])
  jest.mocked(fetchTranscriptTags).mockResolvedValue([])
  jest.mocked(createTranscriptTag).mockImplementation(async (_t, id, name, color) => answer(id, name, color, 'created'))
  jest.mocked(undoCreatedTag).mockResolvedValue('deleted')
})

test('adding a tag is a step: undo takes it off, redo puts it back', async () => {
  const hook = await setUp()
  act(() => hook.result.current.tags.handlers.onAdd(INTERVIEW))
  await waitFor(() => expect(on(hook)).toEqual(['Interview']))
  expect(addTranscriptTag).toHaveBeenCalledWith('t1', 'g1')
  expect(hook.result.current.history.undoLabel).toBe('add tag')

  act(() => hook.result.current.history.undo())
  await waitFor(() => expect(on(hook)).toEqual([]))
  expect(removeTranscriptTag).toHaveBeenCalledWith('t1', 'g1')

  act(() => hook.result.current.history.redo())
  await waitFor(() => expect(on(hook)).toEqual(['Interview']))
  expect(addTranscriptTag).toHaveBeenCalledTimes(2)
})

test('removing a tag is a step: undo puts it back', async () => {
  jest.mocked(fetchTranscriptTags).mockResolvedValue([{ transcript_id: 't1', tag_id: 'g1' }])
  const hook = await setUp()
  act(() => hook.result.current.tags.handlers.onRemove(INTERVIEW))
  await waitFor(() => expect(on(hook)).toEqual([]))
  act(() => hook.result.current.history.undo())
  await waitFor(() => expect(on(hook)).toEqual(['Interview']))
  expect(addTranscriptTag).toHaveBeenCalledWith('t1', 'g1')
})

describe('creating a tag', () => {
  async function created(hook: Hook, name = 'Fresh') {
    act(() => hook.result.current.tags.handlers.onCreate(name))
    await waitFor(() => expect(on(hook)).toContain(name))
    await settled(hook)
    const [transcriptId, id, sentName, color] = jest.mocked(createTranscriptTag).mock.calls.at(-1)!
    return { transcriptId, id, sentName, color }
  }

  test('sends a fresh id with the least used colour', async () => {
    const hook = await setUp()
    const sent = await created(hook)
    expect(sent).toEqual({ transcriptId: 't1', id: expect.any(String), sentName: 'Fresh', color: '#C73E1D' })
    expect(hook.result.current.history.undoLabel).toBe('create tag')
  })

  test('undo deletes a new tag nothing else uses', async () => {
    const hook = await setUp()
    const { id } = await created(hook)
    act(() => hook.result.current.history.undo())
    await waitFor(() => expect(hook.result.current.store.tag(id)).toBeUndefined())
    expect(undoCreatedTag).toHaveBeenCalledWith('t1', id)
    expect(on(hook)).toEqual([])
    expect(toast).not.toHaveBeenCalled()
  })

  test('undo keeps a new tag another transcript uses by now, and says so', async () => {
    jest.mocked(undoCreatedTag).mockResolvedValue('kept')
    const hook = await setUp()
    const { id } = await created(hook)
    act(() => hook.result.current.history.undo())
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: keptToast('Fresh') }))
    expect(hook.result.current.store.tag(id)?.name).toBe('Fresh')
    expect(on(hook)).toEqual([])
  })

  test('undo of a tag already deleted elsewhere is quiet', async () => {
    jest.mocked(undoCreatedTag).mockResolvedValue('gone')
    const hook = await setUp()
    await created(hook)
    act(() => hook.result.current.history.undo())
    await waitFor(() => expect(hook.result.current.history.canRedo).toBe(true))
    expect(toast).not.toHaveBeenCalled()
  })

  test('redo recreates it under the same id, name and colour, and stays a create', async () => {
    const hook = await setUp()
    const first = await created(hook)
    act(() => hook.result.current.history.undo())
    await waitFor(() => expect(on(hook)).toEqual([]))
    act(() => hook.result.current.history.redo())
    await waitFor(() => expect(on(hook)).toEqual(['Fresh']))
    expect(jest.mocked(createTranscriptTag).mock.calls.at(-1)).toEqual(['t1', first.id, 'Fresh', first.color])
    expect(hook.result.current.history.undoLabel).toBe('create tag')
  })

  test('a name another tag took is that tag: undo only takes it off', async () => {
    jest.mocked(createTranscriptTag).mockResolvedValue(answer('g9', 'Fresh', '#7C3AED', 'adopted'))
    const hook = await setUp()
    await created(hook)
    expect(hook.result.current.history.undoLabel).toBe('add tag')
    act(() => hook.result.current.history.undo())
    await waitFor(() => expect(on(hook)).toEqual([]))
    expect(removeTranscriptTag).toHaveBeenCalledWith('t1', 'g9')
    expect(undoCreatedTag).not.toHaveBeenCalled()

    act(() => hook.result.current.history.redo())
    await waitFor(() => expect(addTranscriptTag).toHaveBeenCalledWith('t1', 'g9'))
  })

  test('redo whose name another tag took by now uses that tag from then on', async () => {
    const hook = await setUp()
    await created(hook)
    act(() => hook.result.current.history.undo())
    await waitFor(() => expect(on(hook)).toEqual([]))
    jest.mocked(createTranscriptTag).mockResolvedValueOnce(answer('g9', 'Fresh', '#7C3AED', 'adopted'))
    act(() => hook.result.current.history.redo())
    await waitFor(() => expect(on(hook)).toEqual(['Fresh']))
    expect(hook.result.current.history.undoLabel).toBe('add tag')
    act(() => hook.result.current.history.undo())
    await waitFor(() => expect(removeTranscriptTag).toHaveBeenCalledWith('t1', 'g9'))
    expect(undoCreatedTag).toHaveBeenCalledTimes(1)
  })

  describe('when an answer is lost', () => {
    test('a create resent finds its own tag, stays a create, and undo still deletes it', async () => {
      // The first attempt commits, then its answer is lost.
      jest.mocked(createTranscriptTag)
        .mockRejectedValueOnce(LOST)
        .mockImplementationOnce(async (_t, id, name, color) => answer(id, name, color, 'own'))
      const hook = await setUp()
      const { id } = await created(hook)
      expect(createTranscriptTag).toHaveBeenCalledTimes(2)
      expect(hook.result.current.history.undoLabel).toBe('create tag')

      act(() => hook.result.current.history.undo())
      await waitFor(() => expect(hook.result.current.store.tag(id)).toBeUndefined())
      expect(undoCreatedTag).toHaveBeenCalledWith('t1', id)
    })

    test('an undo resent finds the tag gone and says nothing', async () => {
      jest.mocked(undoCreatedTag).mockRejectedValueOnce(LOST).mockResolvedValueOnce('gone')
      const hook = await setUp()
      const { id } = await created(hook)
      act(() => hook.result.current.history.undo())
      await waitFor(() => expect(hook.result.current.store.tag(id)).toBeUndefined())
      expect(undoCreatedTag).toHaveBeenCalledTimes(2)
      expect(toast).not.toHaveBeenCalled()
      expect(hook.result.current.history.canRedo).toBe(true)
    })

    test('a redo resent finds its own tag and stays a create', async () => {
      const hook = await setUp()
      const { id } = await created(hook)
      act(() => hook.result.current.history.undo())
      await waitFor(() => expect(on(hook)).toEqual([]))
      jest.mocked(createTranscriptTag)
        .mockRejectedValueOnce(LOST)
        .mockImplementationOnce(async (_t, sentId, name, color) => answer(sentId, name, color, 'own'))
      act(() => hook.result.current.history.redo())
      await waitFor(() => expect(on(hook)).toEqual(['Fresh']))
      expect(hook.result.current.history.undoLabel).toBe('create tag')
      act(() => hook.result.current.history.undo())
      await waitFor(() => expect(undoCreatedTag).toHaveBeenLastCalledWith('t1', id))
    })
  })
})

test('undoing a remove whose tag was deleted elsewhere clears the history', async () => {
  jest.mocked(fetchTranscriptTags).mockResolvedValue([{ transcript_id: 't1', tag_id: 'g1' }])
  const hook = await setUp()
  act(() => hook.result.current.tags.handlers.onRemove(INTERVIEW))
  await waitFor(() => expect(on(hook)).toEqual([]))
  await settled(hook)

  jest.mocked(addTranscriptTag).mockRejectedValueOnce({ code: 'SP001', message: 'tag not found' })
  act(() => hook.result.current.history.undo())
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Undo history cleared' })))
  expect(hook.result.current.history.canUndo).toBe(false)
  expect(hook.result.current.history.canRedo).toBe(false)
  expect(on(hook)).toEqual([])
})

test('a second choice while one is waiting is turned away', async () => {
  let release!: () => void
  jest.mocked(addTranscriptTag).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
  const other = tag('g2', 'Research')
  jest.mocked(fetchTags).mockResolvedValue([INTERVIEW, other])
  const hook = await setUp()
  act(() => hook.result.current.tags.handlers.onAdd(INTERVIEW))
  await waitFor(() => expect(hook.result.current.tags.blocked).toBe(true))
  act(() => hook.result.current.tags.handlers.onAdd(other))
  expect(addTranscriptTag).toHaveBeenCalledTimes(1)
  await act(async () => { release() })
  await settled(hook)
  expect(on(hook)).toEqual(['Interview'])
})
