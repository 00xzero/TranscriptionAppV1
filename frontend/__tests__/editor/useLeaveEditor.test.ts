import { StrictMode, createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useEditorWriteQueue } from '@/app/(app)/editor/[id]/hooks/useEditorWriteQueue'
import { LEAVE_SHOW_AFTER_MS, LEAVE_STALL_MS, useLeaveEditor } from '@/app/(app)/editor/[id]/hooks/useLeaveEditor'
import { holdLeave } from '@/lib/editor/leaveGuard'
import { LEFT_UNSAVED_TOAST } from '@/lib/editor/unsavedToasts'
import type { SegmentTextEdit } from '@/contracts/db'

const mockSetSegmentTexts = jest.fn()
jest.mock('@/lib/supabase/queries', () => ({
  setSegmentTexts: (...args: unknown[]) => mockSetSegmentTexts(...args),
}))
const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }))
const mockToast = jest.fn()
jest.mock('@/components/ui/toaster', () => ({ toast: (...args: unknown[]) => mockToast(...args) }))

const EDIT: SegmentTextEdit = { segment_id: 'seg-1', expected_revision: 0, expected_text: 'before', text: 'typed' }

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

/** Lets queued tasks and their promise chains run, and timers advance. */
async function settle(ms = 0) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms) })
}

function setup({ drafts = false, strict = false } = {}) {
  const state = { drafts }
  const editing = {
    saveNow: jest.fn(),
    hasDrafts: jest.fn(() => state.drafts),
    draftEdits: jest.fn(() => state.drafts ? { edits: [EDIT], texts: ['typed'] } : { edits: [], texts: [] }),
  }
  const hook = renderHook(({ reconnecting }: { reconnecting: boolean }) => {
    const queue = useEditorWriteQueue()
    return { queue, leaving: useLeaveEditor({ queue, editing, reconnecting }) }
  }, {
    initialProps: { reconnecting: false },
    wrapper: strict ? ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children) : undefined,
  })
  return { ...hook, editing, state }
}

describe('leaving the editor', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockPush.mockReset()
    mockReplace.mockReset()
    mockSetSegmentTexts.mockReset().mockResolvedValue([])
    mockToast.mockReset()
  })
  afterEach(() => jest.useRealTimers())

  it('lets the user go at once when nothing waits', () => {
    setup()
    expect(holdLeave(jest.fn())).toBe(false)
  })

  it('holds a navigation until the queue is empty, saving drafts now', async () => {
    const { result, editing } = setup()
    const write = deferred()
    void result.current.queue(() => write.promise)
    const go = jest.fn()
    act(() => { expect(holdLeave(go)).toBe(true) })
    expect(editing.saveNow).toHaveBeenCalled()
    await settle(100)
    expect(go).not.toHaveBeenCalled()
    write.resolve()
    await settle()
    expect(go).toHaveBeenCalledTimes(1)
    expect(result.current.leaving.phase).toBeNull()
  })

  it('goes to a held link with the editor\'s router', async () => {
    const { result } = setup()
    const write = deferred()
    void result.current.queue(() => write.promise)
    act(() => { holdLeave({ href: '/people' }) })
    act(() => { holdLeave({ href: '/projects', replace: true, scroll: false }) })
    write.resolve()
    await settle()
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/projects', { scroll: false })
  })

  it('says it is saving only once the wait is long enough to notice', async () => {
    const { result } = setup()
    void result.current.queue(() => new Promise<void>(() => {}))
    act(() => { holdLeave(jest.fn()) })
    await settle(LEAVE_SHOW_AFTER_MS - 1)
    expect(result.current.leaving.phase).toBeNull()
    await settle(1)
    expect(result.current.leaving.phase).toBe('saving')
  })

  it('offers a choice once saving is slow, and goes by itself if it then finishes', async () => {
    const { result } = setup()
    const write = deferred()
    void result.current.queue(() => write.promise)
    const go = jest.fn()
    act(() => { holdLeave(go) })
    await settle(LEAVE_STALL_MS)
    expect(result.current.leaving.phase).toBe('slow')
    write.resolve()
    await settle()
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('offers a choice while the editor is reconnecting', async () => {
    const { result, rerender } = setup()
    void result.current.queue(() => new Promise<void>(() => {}))
    act(() => { holdLeave(jest.fn()) })
    await settle(LEAVE_SHOW_AFTER_MS)
    rerender({ reconnecting: true })
    expect(result.current.leaving.phase).toBe('offline')
  })

  it('tries a draft once more, then says its save failed', async () => {
    const { result, editing } = setup({ drafts: true })
    const go = jest.fn()
    act(() => { holdLeave(go) })
    await settle()
    expect(editing.saveNow).toHaveBeenCalledTimes(2)
    expect(result.current.leaving.phase).toBe('failed')
    expect(go).not.toHaveBeenCalled()
  })

  it('goes to where the user asked last', async () => {
    const { result } = setup()
    const write = deferred()
    void result.current.queue(() => write.promise)
    const first = jest.fn()
    const second = jest.fn()
    act(() => { holdLeave(first); holdLeave(second) })
    write.resolve()
    await settle()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('stays when asked, and does not go when the saves finish', async () => {
    const { result } = setup()
    const write = deferred()
    void result.current.queue(() => write.promise)
    const go = jest.fn()
    act(() => { holdLeave(go) })
    await settle(LEAVE_SHOW_AFTER_MS)
    act(() => result.current.leaving.stay())
    expect(result.current.leaving.phase).toBeNull()
    write.resolve()
    await settle()
    expect(go).not.toHaveBeenCalled()
  })

  it('leaves without saving: goes at once and sends nothing as it closes', async () => {
    const { result, unmount } = setup({ drafts: true })
    const go = jest.fn()
    act(() => { holdLeave(go) })
    await settle()
    act(() => result.current.leaving.leaveAnyway())
    expect(go).toHaveBeenCalledTimes(1)
    unmount()
    await settle(1)
    expect(mockSetSegmentTexts).not.toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('leaves without saving through a navigation that asks the editor again (sign-out)', async () => {
    const { result } = setup({ drafts: true })
    const signedOut = jest.fn()
    const signOut = () => { if (!holdLeave(signOut)) signedOut() }
    act(() => signOut())
    await settle(LEAVE_SHOW_AFTER_MS)
    expect(result.current.leaving.phase).toBe('failed')
    act(() => result.current.leaving.leaveAnyway())
    expect(signedOut).toHaveBeenCalledTimes(1)
    await settle(LEAVE_SHOW_AFTER_MS)
    expect(result.current.leaving.phase).toBeNull()
  })

  it('waits for a write queued just as the queue went idle', async () => {
    const { result } = setup()
    const first = deferred()
    const second = deferred()
    void result.current.queue(() => first.promise)
    // Queued as the queue goes idle, before the hold's wait sees it.
    void result.current.queue.idle().then(() => { void result.current.queue(() => second.promise) })
    const go = jest.fn()
    act(() => { holdLeave(go) })
    first.resolve()
    await settle()
    expect(go).not.toHaveBeenCalled()
    second.resolve()
    await settle()
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('keeps a hold through an effect run again at once (Fast Refresh, Strict Mode)', async () => {
    const { result } = setup({ strict: true })
    void result.current.queue(() => new Promise<void>(() => {}))
    act(() => { holdLeave(jest.fn()) })
    await settle(LEAVE_SHOW_AFTER_MS)
    expect(result.current.leaving.phase).toBe('saving')
  })

  it('drops a held navigation once the editor has gone another way (browser Back)', async () => {
    const { result, unmount } = setup()
    const write = deferred()
    void result.current.queue(() => write.promise)
    const go = jest.fn()
    act(() => { holdLeave(go) })
    unmount()
    write.resolve()
    await settle(LEAVE_STALL_MS)
    expect(go).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  describe('closing without being held (browser Back)', () => {
    it('sends waiting drafts once, saying nothing when they are saved', async () => {
      const { unmount } = setup({ drafts: true })
      unmount()
      await settle(1)
      expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
      expect(mockSetSegmentTexts).toHaveBeenCalledWith([EDIT])
      expect(mockToast).not.toHaveBeenCalled()
    })

    it('says once, with the text to copy, when that send fails, and does not send again', async () => {
      mockSetSegmentTexts.mockRejectedValue({ code: '', message: 'TypeError: Failed to fetch' })
      const { unmount } = setup({ drafts: true })
      unmount()
      await settle(60000)
      expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
      expect(mockToast).toHaveBeenCalledTimes(1)
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: LEFT_UNSAVED_TOAST, action: expect.objectContaining({ label: 'Copy text' }),
      }))
    })

    it('says so when an action was cut off', async () => {
      const { result, unmount } = setup()
      void result.current.queue(() => new Promise<void>(() => {}))
      unmount()
      await settle(1)
      expect(mockSetSegmentTexts).not.toHaveBeenCalled()
      expect(mockToast).toHaveBeenCalledTimes(1)
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: LEFT_UNSAVED_TOAST }))
    })

    it('sends nothing for a transcript just deleted', async () => {
      const { result, unmount } = setup({ drafts: true })
      act(() => result.current.leaving.abandon())
      unmount()
      await settle(1)
      expect(mockSetSegmentTexts).not.toHaveBeenCalled()
    })

    it('stops holding navigation once closed', async () => {
      const { result, unmount } = setup()
      void result.current.queue(() => new Promise<void>(() => {}))
      unmount()
      await settle(1)
      expect(holdLeave(jest.fn())).toBe(false)
    })
  })

  describe('leaving the page', () => {
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }

    it('asks first while a draft or a write waits, and starts saving', () => {
      const { editing, state } = setup({ drafts: true })
      expect(unload()).toBe(true)
      expect(editing.saveNow).toHaveBeenCalled()
      state.drafts = false
      expect(unload()).toBe(false)
    })

    it('does not ask while only a read waits', () => {
      const { result } = setup()
      void result.current.queue(() => new Promise<void>(() => {}), 'read')
      expect(unload()).toBe(false)
    })
  })
})
