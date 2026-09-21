import { act, renderHook, waitFor } from '@testing-library/react'
import type { ProjectSpeakerSummary } from '@/contracts/db'
import {
  transcriptRevision,
  useProjectSpeakerSummaries,
} from '@/lib/projects/useProjectSpeakerSummaries'

const mockFetch = jest.fn()

jest.mock('@/lib/supabase/queries', () => ({
  fetchProjectSpeakerSummaries: (...args: unknown[]) => mockFetch(...args),
}))

const summary = (projectId: string, speakerCount: number): ProjectSpeakerSummary => ({
  project_id: projectId,
  speaker_count: speakerCount,
  preview: [],
})

const summaryMap = (projectId: string, speakerCount: number) =>
  new Map([[projectId, summary(projectId, speakerCount)]])

/** A promise plus the handle to settle it, so tests control resolution order. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useProjectSpeakerSummaries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('issues one request for the whole set of projects', async () => {
    mockFetch.mockResolvedValue(new Map())

    const { result } = renderHook(() => useProjectSpeakerSummaries(['a', 'b', 'c'], true))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(['a', 'b', 'c'], { includeDescendants: true })
  })

  test('does not call the RPC at all for an empty project set', async () => {
    const { result } = renderHook(() => useProjectSpeakerSummaries([], true))

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.summaries.size).toBe(0)
  })

  test('passes the direct scope through', async () => {
    mockFetch.mockResolvedValue(new Map())

    renderHook(() => useProjectSpeakerSummaries(['a'], false))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(['a'], { includeDescendants: false }))
  })

  test('refetches when the scope flag changes', async () => {
    mockFetch.mockResolvedValue(new Map())

    const { rerender } = renderHook(
      ({ descendants }) => useProjectSpeakerSummaries(['a'], descendants),
      { initialProps: { descendants: true } }
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    rerender({ descendants: false })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(mockFetch).toHaveBeenLastCalledWith(['a'], { includeDescendants: false })
  })

  test('does not refetch when the same ids are passed in a new array', async () => {
    mockFetch.mockResolvedValue(new Map())

    const { rerender } = renderHook(({ ids }) => useProjectSpeakerSummaries(ids, true), {
      initialProps: { ids: ['a', 'b'] },
    })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    rerender({ ids: ['a', 'b'] })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
  })

  // Navigating away must not leave the previous project's avatars on screen for
  // even one frame, and the superseded response must never land.
  test('drops data for a superseded project set during rapid navigation', async () => {
    const first = deferred<Map<string, ProjectSpeakerSummary>>()
    const second = deferred<Map<string, ProjectSpeakerSummary>>()
    mockFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const { result, rerender } = renderHook(
      ({ ids }) => useProjectSpeakerSummaries(ids, false),
      { initialProps: { ids: ['project-a'] } }
    )

    rerender({ ids: ['project-b'] })
    // Cleared in the same render that changed the key, before anything resolves.
    expect(result.current.summaries.size).toBe(0)
    expect(result.current.loading).toBe(true)

    await act(async () => {
      second.resolve(summaryMap('project-b', 2))
      first.resolve(summaryMap('project-a', 9))
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.summaries.get('project-b')?.speaker_count).toBe(2)
    expect(result.current.summaries.has('project-a')).toBe(false)
  })

  // The case a cancelled-flag guard misses: same scope, two in-flight requests
  // (an initial load and a focus refetch), the older one resolving last.
  test('ignores an older same-scope response that resolves after a newer one', async () => {
    const initial = deferred<Map<string, ProjectSpeakerSummary>>()
    const refetch = deferred<Map<string, ProjectSpeakerSummary>>()
    mockFetch.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refetch.promise)

    const { result } = renderHook(() => useProjectSpeakerSummaries(['project-a'], false))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))

    await act(async () => {
      refetch.resolve(summaryMap('project-a', 5))
    })
    await waitFor(() => expect(result.current.summaries.get('project-a')?.speaker_count).toBe(5))

    // The stale initial request lands last and must not overwrite the fresher data.
    await act(async () => {
      initial.resolve(summaryMap('project-a', 1))
    })
    expect(result.current.summaries.get('project-a')?.speaker_count).toBe(5)
  })

  describe('freshness', () => {
    test('refetches when the transcript revision changes', async () => {
      mockFetch.mockResolvedValue(summaryMap('project-a', 1))

      const { rerender } = renderHook(
        ({ revision }) => useProjectSpeakerSummaries(['project-a'], false, revision),
        { initialProps: { revision: '1:2026-09-01T00:00:00Z' } }
      )
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

      // A transcript was added, moved, or re-completed.
      rerender({ revision: '2:2026-09-02T00:00:00Z' })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    })

    test('does not refetch when the revision is unchanged', async () => {
      mockFetch.mockResolvedValue(summaryMap('project-a', 1))

      const { rerender } = renderHook(
        ({ revision }) => useProjectSpeakerSummaries(['project-a'], false, revision),
        { initialProps: { revision: '1:2026-09-01T00:00:00Z' } }
      )
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

      rerender({ revision: '1:2026-09-01T00:00:00Z' })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    })

    // A revision bump is a refresh, not a navigation: blanking the avatars while
    // the new answer is in flight would flicker on every transcript edit.
    test('keeps showing the current summary while a revision refetch is in flight', async () => {
      const first = deferred<Map<string, ProjectSpeakerSummary>>()
      const second = deferred<Map<string, ProjectSpeakerSummary>>()
      mockFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

      const { result, rerender } = renderHook(
        ({ revision }) => useProjectSpeakerSummaries(['project-a'], false, revision),
        { initialProps: { revision: 'rev-1' } }
      )

      await act(async () => {
        first.resolve(summaryMap('project-a', 3))
      })
      await waitFor(() => expect(result.current.summaries.get('project-a')?.speaker_count).toBe(3))

      rerender({ revision: 'rev-2' })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))

      // Still the old value, and not flagged as loading.
      expect(result.current.summaries.get('project-a')?.speaker_count).toBe(3)
      expect(result.current.loading).toBe(false)

      await act(async () => {
        second.resolve(summaryMap('project-a', 4))
      })
      await waitFor(() => expect(result.current.summaries.get('project-a')?.speaker_count).toBe(4))
    })

    // A project switch IS a navigation, so it must clear in the same render.
    test('still clears immediately when the project set changes', async () => {
      mockFetch.mockReturnValue(new Promise(() => {}))

      const { result, rerender } = renderHook(
        ({ ids }) => useProjectSpeakerSummaries(ids, false, 'rev-1'),
        { initialProps: { ids: ['project-a'] } }
      )

      rerender({ ids: ['project-b'] })
      expect(result.current.summaries.size).toBe(0)
      expect(result.current.loading).toBe(true)
    })
  })

  describe('project set identity', () => {
    // The Library rail re-ranks on activity, so the same cards arrive in a new
    // order. That is the same request, not a new one.
    test('treats a reordered project set as unchanged', async () => {
      mockFetch.mockResolvedValue(summaryMap('project-a', 2))

      const { rerender } = renderHook(({ ids }) => useProjectSpeakerSummaries(ids, true), {
        initialProps: { ids: ['a', 'b', 'c'] },
      })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

      rerender({ ids: ['c', 'a', 'b'] })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    })

    // The combination that used to blank the rail: activity reorders the cards
    // AND bumps the revision, so a reorder-insensitive key still has to hold.
    test('keeps the avatars on screen when a reorder arrives with a revision bump', async () => {
      const initial = deferred<Map<string, ProjectSpeakerSummary>>()
      const refetch = deferred<Map<string, ProjectSpeakerSummary>>()
      mockFetch.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refetch.promise)

      const { result, rerender } = renderHook(
        ({ ids, revision }) => useProjectSpeakerSummaries(ids, true, revision),
        { initialProps: { ids: ['a', 'b'], revision: 'rev-1' } }
      )

      await act(async () => {
        initial.resolve(summaryMap('a', 3))
      })
      await waitFor(() => expect(result.current.summaries.get('a')?.speaker_count).toBe(3))

      rerender({ ids: ['b', 'a'], revision: 'rev-2' })

      // Refetched for freshness, but nothing was blanked.
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
      expect(result.current.summaries.get('a')?.speaker_count).toBe(3)
      expect(result.current.loading).toBe(false)
    })

    test('de-duplicates repeated ids before requesting', async () => {
      mockFetch.mockResolvedValue(new Map())

      renderHook(() => useProjectSpeakerSummaries(['b', 'a', 'b'], true))

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
      expect(mockFetch).toHaveBeenCalledWith(['a', 'b'], { includeDescendants: true })
    })

    test('a genuinely different project set still clears', async () => {
      mockFetch.mockReturnValue(new Promise(() => {}))

      const { result, rerender } = renderHook(
        ({ ids }) => useProjectSpeakerSummaries(ids, true, 'rev-1'),
        { initialProps: { ids: ['a', 'b'] } }
      )

      rerender({ ids: ['a', 'c'] })
      expect(result.current.summaries.size).toBe(0)
      expect(result.current.loading).toBe(true)
    })
  })

  describe('transcriptRevision', () => {
    test('changes when a transcript is added or removed', () => {
      const a = { updated_at: '2026-09-01T00:00:00Z' }
      const b = { updated_at: '2026-09-01T00:00:00Z' }
      expect(transcriptRevision([a])).not.toBe(transcriptRevision([a, b]))
    })

    test('changes when a transcript is touched', () => {
      expect(transcriptRevision([{ updated_at: '2026-09-01T00:00:00Z' }])).not.toBe(
        transcriptRevision([{ updated_at: '2026-09-02T00:00:00Z' }])
      )
    })

    test('is stable for the same set in a different order', () => {
      const a = { updated_at: '2026-09-01T00:00:00Z' }
      const b = { updated_at: '2026-09-02T00:00:00Z' }
      expect(transcriptRevision([a, b])).toBe(transcriptRevision([b, a]))
    })

    test('is stable for an empty set', () => {
      expect(transcriptRevision([])).toBe(transcriptRevision([]))
    })
  })

  test('refetches on window focus', async () => {
    mockFetch.mockResolvedValue(summaryMap('project-a', 3))

    const { result } = renderHook(() => useProjectSpeakerSummaries(['project-a'], false))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
  })

  test('treats a failure as non-blocking and logs it', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockRejectedValue(new Error('rpc exploded'))

    const { result } = renderHook(() => useProjectSpeakerSummaries(['project-a'], false))

    await waitFor(() => expect(result.current.loading).toBe(false))
    // No summary, so the surface omits the avatars rather than claiming zero.
    expect(result.current.summaries.size).toBe(0)
    expect(consoleError).toHaveBeenCalledWith(
      '[projects] Failed to load speaker summaries:',
      expect.any(Error)
    )

    consoleError.mockRestore()
  })
})
