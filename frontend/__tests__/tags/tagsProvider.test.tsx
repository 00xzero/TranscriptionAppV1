import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Tag, TranscriptTag } from '@/contracts/db'
import { fetchTags, fetchTranscriptTags } from '@/lib/supabase/queries'
import { TagsProvider, useTags } from '@/lib/tags/TagsProvider'
import { withLink } from '@/lib/tags/snapshot'
import { AccountChangedError } from '@/lib/auth/account-boundary'
import { createSender, SendClosed } from '@/lib/editor/untilAnswered'

const tag = (id: string, name: string): Tag => ({
  id, user_id: 'u1', name, color: '#4F638C', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
})
const link = (transcript_id: string, tag_id: string): TranscriptTag => ({ transcript_id, tag_id })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const wrapper = ({ children }: { children: ReactNode }) => <TagsProvider>{children}</TagsProvider>
const linked = (result: { current: ReturnType<typeof useTags> }, transcriptId: string) =>
  result.current.tagsOf(transcriptId).map((entry) => entry.id)

const INTERVIEW = tag('g1', 'Interview')
const RESEARCH = tag('g2', 'Research')

beforeEach(() => {
  jest.mocked(fetchTags).mockReset().mockResolvedValue([INTERVIEW, RESEARCH])
  jest.mocked(fetchTranscriptTags).mockReset().mockResolvedValue([link('t1', 'g1')])
})

async function loaded() {
  const hook = renderHook(() => useTags(), { wrapper })
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}

test('loads every tag A–Z and the tags on each transcript', async () => {
  jest.mocked(fetchTags).mockResolvedValue([RESEARCH, INTERVIEW])
  const { result } = await loaded()
  expect(result.current.tags.map((entry) => entry.name)).toEqual(['Interview', 'Research'])
  expect(linked(result, 't1')).toEqual(['g1'])
  expect(result.current.countFor('g1', new Set(['t1']))).toBe(1)
  expect(result.current.countFor('g1', new Set(['t2']))).toBe(0)
})

test('a reload that started before a write and lands after it is thrown away and read again', async () => {
  const { result } = await loaded()
  const stale = deferred<TranscriptTag[]>()
  jest.mocked(fetchTranscriptTags).mockReturnValueOnce(stale.promise)
  let reloaded!: Promise<boolean>
  act(() => { reloaded = result.current.reload() })

  await act(() => result.current.write({
    edit: (s) => withLink(s, 't2', 'g2', true),
    send: async () => undefined,
  }))
  expect(linked(result, 't2')).toEqual(['g2'])

  // The stale read predates the write; the fresh one includes it.
  jest.mocked(fetchTranscriptTags).mockResolvedValue([link('t1', 'g1'), link('t2', 'g2')])
  await act(async () => {
    stale.resolve([link('t1', 'g1')])
    await reloaded
  })
  expect(fetchTranscriptTags).toHaveBeenCalledTimes(3)
  expect(linked(result, 't2')).toEqual(['g2'])
})

test('a reload landing while a write is out keeps its edit on top', async () => {
  const { result } = await loaded()
  const answer = deferred<void>()
  let written!: Promise<void>
  act(() => {
    written = result.current.write({ edit: (s) => withLink(s, 't2', 'g2', true), send: () => answer.promise })
  })
  expect(linked(result, 't2')).toEqual(['g2'])

  await act(async () => { await result.current.reload() })
  expect(linked(result, 't2')).toEqual(['g2'])

  await act(async () => {
    answer.resolve()
    await written
  })
  expect(linked(result, 't2')).toEqual(['g2'])
})

test('one failed write undoes only itself, next to one that succeeded', async () => {
  const { result } = await loaded()
  const good = deferred<void>()
  const bad = deferred<void>()
  let first!: Promise<void>
  let second!: Promise<void>
  act(() => {
    first = result.current.write({ edit: (s) => withLink(s, 't2', 'g1', true), send: () => good.promise })
    second = result.current.write({ edit: (s) => withLink(s, 't2', 'g2', true), send: () => bad.promise })
  })
  expect(linked(result, 't2')).toEqual(['g1', 'g2'])

  await act(async () => {
    good.resolve()
    await first
  })
  await act(async () => {
    bad.reject({ code: 'SP003', message: 'invalid' })
    await expect(second).rejects.toEqual({ code: 'SP003', message: 'invalid' })
  })
  expect(linked(result, 't2')).toEqual(['g1'])
  expect(linked(result, 't1')).toEqual(['g1'])
})

describe('the three kinds of failure', () => {
  test('a database refusal removes the edit and reads nothing again', async () => {
    const { result } = await loaded()
    jest.mocked(fetchTranscriptTags).mockClear()
    await act(async () => {
      await expect(result.current.write({
        edit: (s) => withLink(s, 't1', 'g1', false),
        send: () => Promise.reject({ code: 'SP001', message: 'gone' }),
      })).rejects.toEqual({ code: 'SP001', message: 'gone' })
    })
    expect(linked(result, 't1')).toEqual(['g1'])
    expect(fetchTranscriptTags).not.toHaveBeenCalled()
  })

  test('an unknown outcome removes the edit and reloads what the database holds', async () => {
    const { result } = await loaded()
    // The write did happen: the reload shows it.
    jest.mocked(fetchTranscriptTags).mockClear().mockResolvedValue([link('t1', 'g1'), link('t3', 'g2')])
    await act(async () => {
      await expect(result.current.write({
        edit: (s) => withLink(s, 't3', 'g2', true),
        send: () => Promise.reject({ code: '', message: 'Failed to fetch' }),
      })).rejects.toBeTruthy()
    })
    await waitFor(() => expect(fetchTranscriptTags).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(linked(result, 't3')).toEqual(['g2']))
  })

  test('a local stop removes the edit and reads nothing again', async () => {
    const { result } = await loaded()
    jest.mocked(fetchTranscriptTags).mockClear()
    await act(async () => {
      await expect(result.current.write({
        edit: (s) => withLink(s, 't3', 'g2', true),
        send: () => Promise.reject(new AccountChangedError()),
      })).rejects.toBeInstanceOf(AccountChangedError)
    })
    expect(linked(result, 't3')).toEqual([])
    expect(fetchTranscriptTags).not.toHaveBeenCalled()
  })
})

test('writes naming the same tag run one after another', async () => {
  const { result } = await loaded()
  const order: string[] = []
  const first = deferred<void>()
  let a!: Promise<void>
  let b!: Promise<void>
  act(() => {
    a = result.current.write({ send: async () => { order.push('a start'); await first.promise; order.push('a end') }, tagIds: ['g1'] })
    b = result.current.write({ send: async () => { order.push('b') }, tagIds: ['g1'] })
  })
  await act(async () => { await Promise.resolve() })
  expect(order).toEqual(['a start'])
  await act(async () => {
    first.resolve()
    await Promise.all([a, b])
  })
  expect(order).toEqual(['a start', 'a end', 'b'])
})

describe('when the editor closes while its write is out', () => {
  test('the edit stays until the request answers, and its answer is kept', async () => {
    const { result } = await loaded()
    const sender = createSender(() => {})
    const answer = deferred<void>()
    let written!: Promise<void>
    act(() => {
      written = result.current.write({
        edit: (s) => withLink(s, 't2', 'g2', true),
        send: () => answer.promise,
        via: sender.send,
      })
    })
    // Let the request go out before the editor closes.
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
    await act(async () => {
      sender.close()
      await expect(written).rejects.toBeInstanceOf(SendClosed)
    })
    expect(linked(result, 't2')).toEqual(['g2'])

    // Answered: kept in the snapshot, with no read needed.
    jest.mocked(fetchTranscriptTags).mockClear()
    await act(async () => { answer.resolve() })
    expect(linked(result, 't2')).toEqual(['g2'])
    expect(fetchTranscriptTags).not.toHaveBeenCalled()
  })

  test('a request refused after the close drops only its edit', async () => {
    const { result } = await loaded()
    const sender = createSender(() => {})
    const answer = deferred<void>()
    let written!: Promise<void>
    act(() => {
      written = result.current.write({ edit: (s) => withLink(s, 't2', 'g2', true), send: () => answer.promise, via: sender.send })
    })
    // Let the request go out before the editor closes.
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
    await act(async () => {
      sender.close()
      await expect(written).rejects.toBeInstanceOf(SendClosed)
    })
    await act(async () => { answer.reject({ code: 'SP001', message: 'gone' }) })
    expect(linked(result, 't2')).toEqual([])
  })

  test('closed while waiting to resend an unanswered request, it reads what the database holds', async () => {
    const { result } = await loaded()
    const sender = createSender(() => {})
    jest.mocked(fetchTranscriptTags).mockClear().mockResolvedValue([link('t1', 'g1'), link('t2', 'g2')])
    let written!: Promise<void>
    act(() => {
      written = result.current.write({
        edit: (s) => withLink(s, 't2', 'g2', true),
        send: () => Promise.reject({ code: '', message: 'Failed to fetch' }),
        via: sender.send,
      })
    })
    await act(async () => { await Promise.resolve() })
    await act(async () => {
      sender.close()
      await expect(written).rejects.toBeInstanceOf(SendClosed)
    })
    await waitFor(() => expect(fetchTranscriptTags).toHaveBeenCalled())
    await waitFor(() => expect(linked(result, 't2')).toEqual(['g2']))
  })
})

describe('when the first load fails', () => {
  test('it says so, and a write answered meanwhile is read back rather than lost', async () => {
    jest.mocked(fetchTags).mockRejectedValueOnce({ code: '', message: 'Failed to fetch' })
    const { result } = renderHook(() => useTags(), { wrapper })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.loaded).toBe(false)
    expect(result.current.error).toBeTruthy()

    // The write succeeds; the database now holds the link.
    jest.mocked(fetchTranscriptTags).mockResolvedValue([link('t1', 'g1'), link('t2', 'g2')])
    await act(async () => {
      await result.current.write({ edit: (s) => withLink(s, 't2', 'g2', true), send: async () => undefined })
    })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(linked(result, 't2')).toEqual(['g2'])
    expect(result.current.error).toBeNull()
  })

  test('reload recovers', async () => {
    jest.mocked(fetchTags).mockRejectedValueOnce({ code: '', message: 'Failed to fetch' })
    const { result } = renderHook(() => useTags(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    await act(async () => { await expect(result.current.reload()).resolves.toBe(true) })
    expect(result.current.loaded).toBe(true)
    expect(result.current.tags.map((entry) => entry.name)).toEqual(['Interview', 'Research'])
  })
})
