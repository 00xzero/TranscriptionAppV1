import { renderHook } from '@testing-library/react'
import { useEditorWriteQueue } from '@/app/(app)/editor/[id]/hooks/useEditorWriteQueue'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

describe('the editor write queue', () => {
  it('runs tasks one at a time, in the order they were queued', async () => {
    const order: string[] = []
    const first = deferred()
    const { result } = renderHook(() => useEditorWriteQueue())
    const a = result.current(async () => { await first.promise; order.push('a') })
    const b = result.current(async () => { order.push('b') })
    await flush()
    expect(order).toEqual([])
    first.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['a', 'b'])
  })

  it('runs the next task after a failed one', async () => {
    const { result } = renderHook(() => useEditorWriteQueue())
    await expect(result.current(async () => { throw new Error('refused') })).rejects.toThrow('refused')
    await expect(result.current(async () => 'ran')).resolves.toBe('ran')
  })

  it('knows while a write or save waits, and when none is left', async () => {
    const held = deferred()
    const { result } = renderHook(() => useEditorWriteQueue())
    const queue = result.current
    expect(queue.writesPending()).toBe(false)
    const task = queue(() => held.promise, 'save')
    expect(queue.writesPending()).toBe(true)
    expect(queue.actionsPending()).toBe(false)
    let idle = false
    void queue.idle().then(() => { idle = true })
    await flush()
    expect(idle).toBe(false)
    held.resolve()
    await task
    await flush()
    expect(idle).toBe(true)
    expect(queue.writesPending()).toBe(false)
  })

  it('counts an action apart from a save of drafts', async () => {
    const held = deferred()
    const { result } = renderHook(() => useEditorWriteQueue())
    const queue = result.current
    const task = queue(() => held.promise)
    expect(queue.actionsPending()).toBe(true)
    held.resolve()
    await task
    await flush()
    expect(queue.actionsPending()).toBe(false)
  })

  it('does not count a read as a write', async () => {
    const held = deferred()
    const { result } = renderHook(() => useEditorWriteQueue())
    const queue = result.current
    const task = queue(() => held.promise, 'read')
    expect(queue.writesPending()).toBe(false)
    let idle = false
    void queue.idle().then(() => { idle = true })
    await flush()
    expect(idle).toBe(true)
    held.resolve()
    await task
  })
})
