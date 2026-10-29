import { act, renderHook, waitFor } from '@testing-library/react'
import { NOTHING_CHANGED, useEditorHistory, type HistoryStep } from '@/app/(app)/editor/[id]/hooks/useEditorHistory'
import { useEditorWriteQueue } from '@/app/(app)/editor/[id]/hooks/useEditorWriteQueue'
import { useSegmentHolds } from '@/app/(app)/editor/[id]/hooks/useSegmentHolds'
import { OutcomeUnknown } from '@/lib/editor/untilAnswered'

jest.mock('@/components/ui/toaster', () => ({ toast: jest.fn() }))
const { toast } = jest.requireMock('@/components/ui/toaster')

function setup({ refresh = async () => true, reconnecting = false }: { refresh?: () => Promise<boolean>; reconnecting?: boolean } = {}) {
  const reveal = jest.fn()
  const refreshMock = jest.fn(refresh)
  const hook = renderHook(({ offline }: { offline: boolean }) => {
    const enqueue = useEditorWriteQueue()
    const holds = useSegmentHolds()
    const history = useEditorHistory({
      enqueue, holds, reveal, refresh: refreshMock, isReconnecting: () => offline, reconnecting: offline,
    })
    return { history, holds, enqueue }
  }, { initialProps: { offline: reconnecting } })
  return { ...hook, reveal, refresh: refreshMock }
}

const step = (label: string, run: HistoryStep['run'] = async (_dir, applied) => { applied() }, extra: Partial<HistoryStep> = {}): HistoryStep =>
  ({ label, run, touches: ['x'], target: () => ({ ids: ['x'] }), ...extra })

beforeEach(() => jest.clearAllMocks())

it('runs rapid presses in order, holding their segments until each has run', async () => {
  const calls: string[] = []
  const { result } = setup()
  act(() => {
    result.current.history.record(step('a', async () => { calls.push('a') }))
    result.current.history.record(step('b', async () => { calls.push('b') }))
  })
  act(() => { result.current.history.undo(); result.current.history.undo() })
  expect(result.current.holds.has('x')).toBe(true)
  await waitFor(() => expect(calls).toEqual(['b', 'a']))
  await waitFor(() => expect(result.current.holds.any).toBe(false))
  expect(result.current.history.redoLabel).toBe('a')
})

it('undoes several steps from the list in order, showing only where the last one landed', async () => {
  const calls: string[] = []
  const { result, reveal } = setup()
  act(() => {
    for (const label of ['a', 'b', 'c']) result.current.history.record(step(label, async (_dir, applied) => { calls.push(label); applied() },
      { target: () => ({ ids: [label] }) }))
  })
  expect(result.current.history.undoNames()).toEqual(['C', 'B', 'A'])
  act(() => result.current.history.undoMany(2))
  // The history moves at once, as for two quick presses.
  expect(result.current.history.undoLabel).toBe('a')
  await waitFor(() => expect(calls).toEqual(['c', 'b']))
  expect(reveal.mock.calls).toEqual([[{ ids: ['b'] }]])
  expect(result.current.history.redoLabel).toBe('b')
})

it('a step refused partway through a list undo cancels the rest', async () => {
  const calls: string[] = []
  const { result, refresh } = setup()
  act(() => {
    result.current.history.record(step('a', async () => { calls.push('a') }))
    result.current.history.record(step('b', async () => { throw { code: 'SP002' } }))
    result.current.history.record(step('c', async () => { calls.push('c') }))
  })
  act(() => result.current.history.undoMany(3))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(result.current.holds.any).toBe(false))
  expect(calls).toEqual(['c'])
  expect(toast).toHaveBeenCalledTimes(1)
  expect(result.current.history.canUndo).toBe(false)
})

it('reveals each step as soon as it is on screen', async () => {
  const { result, reveal } = setup()
  act(() => result.current.history.record(step('typing')))
  act(() => result.current.history.undo())
  await waitFor(() => expect(reveal).toHaveBeenCalledWith({ ids: ['x'] }))
})

it('a text step lets go of its segment once on screen, before its write is answered', async () => {
  const { result } = setup()
  let answer!: () => void
  act(() => result.current.history.record(step('typing', async (_dir, applied) => {
    applied()
    await new Promise<void>((resolve) => { answer = resolve })
  }, { releaseOnApply: true })))
  act(() => result.current.history.undo())
  await waitFor(() => expect(answer).toBeDefined())
  expect(result.current.holds.has('x')).toBe(false)
  await act(async () => answer())
})

it('a pressed undo still runs after a new edit empties redo', async () => {
  const { result } = setup()
  let finish!: () => void
  await act(async () => { void result.current.enqueue(() => new Promise<void>((resolve) => { finish = resolve })) })
  const run = jest.fn(async () => {})
  act(() => {
    result.current.history.record(step('x', run))
    result.current.history.undo()
    result.current.history.record(step('y'))
  })
  expect(result.current.holds.has('x')).toBe(true)
  expect(result.current.history.canRedo).toBe(false)
  await act(async () => finish())
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  expect(result.current.history.undoLabel).toBe('y')
})

it('a failure goes back to before the press and cancels the presses queued after it', async () => {
  const { result } = setup()
  const later = jest.fn(async () => {})
  act(() => {
    result.current.history.record(step('a', later))
    result.current.history.record(step('b', async () => { throw { code: 'SP003' } }))
  })
  act(() => { result.current.history.undo(); result.current.history.undo() })
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't undo b" })))
  expect(later).not.toHaveBeenCalled()
  expect(result.current.history.undoLabel).toBe('b')
  expect(result.current.holds.any).toBe(false)
})

it('a failure after something new was recorded clears instead of restoring', async () => {
  const { result } = setup()
  let reject!: (reason: unknown) => void
  act(() => result.current.history.record(step('x', () => new Promise((_, fail) => { reject = fail }))))
  act(() => result.current.history.undo())
  await waitFor(() => expect(reject).toBeDefined())
  act(() => result.current.history.record(step('y')))
  await act(async () => reject({ code: 'SP003' }))
  expect(result.current.history.canUndo).toBe(false)
  expect(result.current.history.canRedo).toBe(false)
})

it.each([
  ['a conflict', { code: 'SP002' }],
  ['a missing row', { code: 'SP001' }],
  ['an unknown outcome', new OutcomeUnknown({ code: 'SP002' })],
])('%s clears once, then reads the database again with undo and redo paused', async (_name, error) => {
  let answer!: (ok: boolean) => void
  const { result, refresh } = setup({ refresh: () => new Promise<boolean>((resolve) => { answer = resolve }) })
  act(() => {
    result.current.history.record(step('earlier'))
    result.current.history.record(step('x', async () => { throw error }))
  })
  act(() => result.current.history.undo())
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(toast).toHaveBeenCalledTimes(1)
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Can't undo — this changed elsewhere", description: 'Undo history cleared' }))
  expect(result.current.history.paused).toBe(true)
  expect(result.current.holds.has('x')).toBe(true)
  // A press while the read is out does nothing.
  act(() => result.current.history.record(step('during')))
  act(() => result.current.history.undo())
  expect(result.current.history.undoLabel).toBe('during')
  await act(async () => answer(true))
  expect(result.current.history.paused).toBe(false)
  expect(result.current.holds.has('x')).toBe(false)
})

it('a refused press says so even when the clear has nothing else to remove', async () => {
  const { result } = setup()
  act(() => result.current.history.record(step('x', async () => { throw { code: 'SP002' } })))
  act(() => {
    result.current.history.undo()
    result.current.history.original(step('title', undefined, { touches: ['title'] }), async () => {})
  })
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Can't undo — this changed elsewhere" }))
  await waitFor(() => expect(result.current.holds.any).toBe(false))
  expect(result.current.history.undoLabel).toBe('title')
})

it('says so when the database refuses the read again', async () => {
  const { result } = setup({ refresh: async () => false })
  act(() => result.current.history.record(step('x', async () => { throw { code: 'SP002' } })))
  act(() => result.current.history.undo())
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Changed in another tab — couldn't refresh" })))
})

it('pauses while reconnecting', () => {
  const { result, rerender } = setup({ reconnecting: true })
  const run = jest.fn(async () => {})
  act(() => result.current.history.record(step('x', run)))
  expect(result.current.history.canUndo).toBe(false)
  expect(result.current.history.paused).toBe(true)
  act(() => result.current.history.undo())
  expect(result.current.history.undoLabel).toBe('x')
  rerender({ offline: false })
  expect(result.current.history.canUndo).toBe(true)
})

describe('original actions', () => {
  it('reserve their place at once and drop it when they fail', async () => {
    const { result } = setup()
    const failed = jest.fn()
    act(() => result.current.history.original(step('split'), async () => { throw { code: 'SP003' } }, failed))
    expect(result.current.history.undoLabel).toBe('split')
    expect(result.current.holds.has('x')).toBe(true)
    await waitFor(() => expect(failed).toHaveBeenCalledWith({ code: 'SP003' }))
    expect(result.current.history.canUndo).toBe(false)
    expect(result.current.holds.any).toBe(false)
  })

  it('a press made before the action failed is skipped', async () => {
    const { result } = setup()
    const run = jest.fn(async () => {})
    let fail!: (reason: unknown) => void
    act(() => result.current.history.original(step('split', run), () => new Promise((_, reject) => { fail = reject }), () => {}))
    act(() => result.current.history.undo())
    await waitFor(() => expect(fail).toBeDefined())
    await act(async () => fail({ code: 'SP003' }))
    await waitFor(() => expect(result.current.holds.any).toBe(false))
    expect(run).not.toHaveBeenCalled()
  })

  it('one that changed nothing is dropped quietly', async () => {
    const { result } = setup()
    const failed = jest.fn()
    act(() => result.current.history.original(step('rename'), async () => { throw NOTHING_CHANGED }, failed))
    await waitFor(() => expect(result.current.holds.any).toBe(false))
    expect(result.current.history.canUndo).toBe(false)
    expect(failed).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('a conflict keeps the steps of actions still waiting to run, which then run on the fresh state', async () => {
    const { result, refresh } = setup()
    const run = jest.fn(async () => {})
    act(() => {
      result.current.history.record(step('earlier'))
      result.current.history.original(step('speaker change'), async () => { throw { code: 'SP002' } })
      result.current.history.original(step('title', run, { touches: ['title'] }), async () => {})
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.holds.any).toBe(false))
    // The title saved after the conflict, and can still be undone.
    expect(result.current.history.undoLabel).toBe('title')
    act(() => result.current.history.undo())
    await waitFor(() => expect(run).toHaveBeenCalledWith('undo', expect.any(Function)))
    expect(result.current.history.canUndo).toBe(false)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('a conflict puts back a waiting action\'s step that was undone before it ran', async () => {
    const { result } = setup()
    let release!: () => void
    act(() => {
      result.current.history.original(step('speaker change'), () => new Promise<void>((_, reject) => { release = () => reject({ code: 'SP002' }) }))
      result.current.history.original(step('title', undefined, { touches: ['title'] }), async () => {})
      result.current.history.undo()
    })
    expect(result.current.history.redoLabel).toBe('title')
    await waitFor(() => expect(release).toBeDefined())
    await act(async () => release())
    await waitFor(() => expect(result.current.holds.any).toBe(false))
    // The press was cancelled with the clear; the title still ran, so its step is back to undo.
    expect(result.current.history.undoLabel).toBe('title')
    expect(result.current.history.canRedo).toBe(false)
  })

  it('a conflict puts back a waiting action\'s step that a later edit took off redo', async () => {
    const { result } = setup()
    const run = jest.fn(async () => {})
    let release!: () => void
    act(() => {
      result.current.history.original(step('speaker change'), () => new Promise<void>((_, reject) => { release = () => reject({ code: 'SP002' }) }))
      result.current.history.original(step('title', run, { touches: ['title'] }), async () => {})
      result.current.history.undo()
      result.current.history.original(step('rename', undefined, { touches: ['person'] }), async () => {})
    })
    expect(result.current.history.canRedo).toBe(false)
    await waitFor(() => expect(release).toBeDefined())
    await act(async () => release())
    await waitFor(() => expect(result.current.holds.any).toBe(false))
    // The title's undo was cancelled and the title saved, so it can still be undone, before the rename.
    expect(run).not.toHaveBeenCalled()
    expect(result.current.history.undoLabel).toBe('rename')
    act(() => { result.current.history.undo(); result.current.history.undo() })
    await waitFor(() => expect(run).toHaveBeenCalledWith('undo', expect.any(Function)))
  })

  it('one refused because something changed elsewhere says so once and reads again', async () => {
    const { result, refresh } = setup()
    act(() => result.current.history.record(step('earlier')))
    act(() => result.current.history.original(step('speaker change'), async () => { throw { code: 'SP002' } }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Changed in another tab — refreshed', description: 'Undo history cleared' }))
    expect(result.current.history.canUndo).toBe(false)
  })
})

it('restoring a snapshot never brings back a dropped action', async () => {
  const { result } = setup()
  const a = step('dead')
  const b = step('failure', async () => { throw { code: 'SP003' } })
  act(() => {
    result.current.history.record(a)
    result.current.history.record(b)
    result.current.history.undo()
    result.current.history.drop(a)
  })
  await waitFor(() => expect(toast).toHaveBeenCalled())
  act(() => result.current.history.drop(b))
  expect(result.current.history.canUndo).toBe(false)
})

it('holds the title apart from segments: Replace is not closed while the title saves', async () => {
  let save!: () => void
  const { result } = setup()
  act(() => {
    result.current.history.original(step('title', undefined, { touches: ['title'], scope: 'title' }),
      () => new Promise<void>((resolve) => { save = resolve }))
  })
  await waitFor(() => expect(save).toBeDefined())
  expect(result.current.holds.locked.has('title')).toBe(true)
  expect(result.current.holds.busy.has('title')).toBe(false)
  expect(result.current.holds.any).toBe(false)
  act(() => save())
  await waitFor(() => expect(result.current.holds.locked.has('title')).toBe(false))
})

