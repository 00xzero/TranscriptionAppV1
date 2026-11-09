import React from 'react'
import { pageAccountFetch } from '@/lib/auth/account-bound-fetch'
import { AccountChangedError } from '@/lib/auth/account-boundary'

import { renderHook, act, waitFor } from '@testing-library/react'
import { useAudioSessionRecovery } from '@/app/(app)/editor/[id]/hooks/useAudioSessionRecovery'

jest.mock('@/lib/auth/account-bound-fetch', () => ({
  pageAccountFetch: jest.fn(jest.requireActual('@/lib/auth/account-bound-fetch').pageAccountFetch),
}))

/** An audio element as far as the hook sees it: events, a position, play. */
class FakeAudio extends EventTarget {
  currentTime = 42
  paused = false
  error: MediaError | null = null
  play = jest.fn(() => Promise.resolve())
  pause = jest.fn(() => { this.paused = true })
}

function setup() {
  const audio = new FakeAudio()
  const onUrlRefreshed = jest.fn()
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://media.test/fresh' }) })
  renderHook(() =>
    useAudioSessionRecovery({
      transcriptId: 't1',
      audioSrc: 'https://media.test/old',
      audioElement: audio as unknown as HTMLAudioElement,
      onUrlRefreshed,
    })
  )
  return { audio, onUrlRefreshed }
}

/** What a browser does when the src is swapped: the old source is abandoned, the new one loads. */
function swapSource(audio: FakeAudio, outcome: 'loadeddata' | 'error') {
  act(() => {
    audio.dispatchEvent(new Event('abort'))
    audio.currentTime = 0
    audio.dispatchEvent(new Event('emptied'))
    audio.dispatchEvent(new Event('loadstart'))
    audio.dispatchEvent(new Event(outcome))
  })
}

describe('useAudioSessionRecovery', () => {
  afterEach(() => jest.restoreAllMocks())

  test('an account-change refusal closes recovery without a retry toast', async () => {
    const fetch = jest.mocked(pageAccountFetch).mockClear().mockRejectedValueOnce(new AccountChangedError())
    const audio = new FakeAudio()
    audio.error = { code: 4 } as MediaError
    const onRecoveryError = jest.fn()
    const onUrlRefreshed = jest.fn()
    renderHook(() => useAudioSessionRecovery({
      transcriptId: 't1', audioSrc: 'old', audioElement: audio as unknown as HTMLAudioElement,
      onRecoveryError, onUrlRefreshed,
    }))
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onRecoveryError).not.toHaveBeenCalled()
    expect(onUrlRefreshed).not.toHaveBeenCalled()
  })

  test('after a refreshed link loads, playback goes back to where it was, past the old source’s abort', async () => {
    const { audio, onUrlRefreshed } = setup()

    act(() => {
      audio.dispatchEvent(new Event('error'))
    })
    await waitFor(() => expect(onUrlRefreshed).toHaveBeenCalledWith('https://media.test/fresh'))
    swapSource(audio, 'loadeddata')

    expect(audio.currentTime).toBe(42)
    expect(audio.play).toHaveBeenCalledTimes(1)
  })

  test('the new source failing ends the wait: a later load does not jump back', async () => {
    const { audio, onUrlRefreshed } = setup()

    act(() => {
      audio.dispatchEvent(new Event('error'))
    })
    await waitFor(() => expect(onUrlRefreshed).toHaveBeenCalled())
    swapSource(audio, 'error')
    act(() => {
      audio.currentTime = 7
      audio.dispatchEvent(new Event('loadeddata'))
    })

    expect(audio.currentTime).toBe(7)
    expect(audio.play).not.toHaveBeenCalled()
  })
})

describe.each(['inline', 'stable'])('recovery cap with %s callbacks', (style) => {
  const mediaError = { code: 4 } as MediaError
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

  function mount(failFetch = false) {
    const audio = new FakeAudio()
    const errors = jest.fn()
    const hold = jest.fn()
    let url = 0
    const fetchMock = jest.fn(async () => ({
      ok: !failFetch, status: failFetch ? 503 : 200,
      json: async () => ({ url: `https://media.test/fresh-${++url}` }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch
    const hook = renderHook(() => {
      const [audioSrc, setAudioSrc] = React.useState('https://media.test/initial')
      const recovery = useAudioSessionRecovery({
        transcriptId: 't1', audioSrc, audioElement: audio as unknown as HTMLAudioElement,
        onUrlRefreshed: style === 'stable' ? setAudioSrc : (src) => setAudioSrc(src),
        onRecoveryError: style === 'stable' ? errors : (retry) => errors(retry),
        onPositionHold: hold,
      })
      return { ...recovery, audioSrc }
    })
    const fail = async () => {
      audio.error = mediaError
      await act(async () => { audio.dispatchEvent(new Event('error')) })
    }
    const startSource = () => act(() => {
      audio.error = null
      audio.dispatchEvent(new Event('abort'))
      audio.currentTime = 0
      audio.dispatchEvent(new Event('loadstart'))
    })
    return { ...hook, audio, fail, startSource, errors, fetchMock, hold }
  }

  test.each([['fast', 50, 50], ['late', 6000, 6000], ['mixed', 6000, 50]])(
    'caps repeated %s failures', async (_name, first, later) => {
      const { fail, fetchMock, startSource, errors, result } = mount()
      await fail()
      expect(result.current.audioSrc).toContain('fresh-1')
      startSource()
      for (let i = 0; i < 20; i++) {
        act(() => { jest.advanceTimersByTime(i === 0 ? first : later) })
        await fail()
      }
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(errors).toHaveBeenCalledTimes(1)
    }
  )

  test.each([[1000, 1], [59999, 1], [60000, 2], [3600000, 2]])(
    'only rearms after a stable load (%i ms)', async (age, requests) => {
      const { fail, fetchMock, startSource, audio, errors } = mount()
      await fail()
      startSource()
      act(() => { audio.dispatchEvent(new Event('loadeddata')); jest.advanceTimersByTime(age) })
      await fail()
      expect(fetchMock).toHaveBeenCalledTimes(requests)
      if (requests === 1) {
        expect(errors).toHaveBeenCalledTimes(1)
        act(() => { jest.advanceTimersByTime(60000) })
        await fail()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(errors).toHaveBeenCalledTimes(1)
      }
    }
  )

  test('metadata releases a paused source without granting another automatic attempt', async () => {
    const { audio, fail, startSource, result, fetchMock, errors, hold } = mount()
    audio.paused = true
    await fail()
    startSource()
    act(() => { audio.dispatchEvent(new Event('loadedmetadata')) })

    expect(audio.currentTime).toBe(42)
    expect(hold).toHaveBeenLastCalledWith(false)
    expect(result.current.toggleWhileRecovering(false)).toBe(false)
    expect(audio.play).not.toHaveBeenCalled()

    act(() => { jest.advanceTimersByTime(60_000) })
    await fail()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledTimes(1)
  })

  test('late data after metadata keeps a newer seek and starts the retry window', async () => {
    const { audio, fail, startSource, fetchMock } = mount()
    await fail()
    startSource()
    act(() => { audio.dispatchEvent(new Event('loadedmetadata')) })
    audio.currentTime = 90
    act(() => { audio.dispatchEvent(new Event('loadeddata')) })
    expect(audio.currentTime).toBe(90)
    expect(audio.play).toHaveBeenCalledTimes(1)
    act(() => { jest.advanceTimersByTime(60_000) })
    await fail()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('a clean abort of the refreshed load releases the hold and Play', async () => {
    const { audio, fail, startSource, result, fetchMock, errors, hold } = mount()
    await fail()
    startSource()
    expect(hold).toHaveBeenLastCalledWith(true)
    act(() => { audio.dispatchEvent(new Event('abort')) })

    expect(hold).toHaveBeenLastCalledWith(false)
    expect(result.current.toggleWhileRecovering(false)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(errors).not.toHaveBeenCalled()
  })

  test('a healthy source survives a failed proactive fetch, and its later terminal error reports', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { audio, fail, errors, fetchMock, hold } = mount(true)
    act(() => { jest.advanceTimersByTime(51 * 60 * 1000) })
    for (let i = 0; i < 20; i++) await act(async () => { audio.dispatchEvent(new Event('stalled')) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(errors).not.toHaveBeenCalled()
    expect(hold).not.toHaveBeenCalledWith(true)
    await fail()
    expect(errors).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('Pause cancels resume intent even before the failed source has been swapped', async () => {
    const { audio, fail, startSource, result, fetchMock } = mount()
    await fail()
    act(() => { expect(result.current.toggleWhileRecovering(true)).toBe(true) })
    startSource()
    act(() => { audio.dispatchEvent(new Event('loadeddata')) })
    expect(audio.currentTime).toBe(42)
    expect(audio.play).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('retry keeps position, merges Play during a slow load, and expires with the session', async () => {
    const { fail, startSource, errors, fetchMock, audio, result, unmount } = mount()
    audio.paused = true
    await fail()
    startSource()
    await fail()
    const retry = errors.mock.calls[0][0]
    await act(async () => { retry() })
    startSource()
    act(() => {
      jest.advanceTimersByTime(4999)
      expect(result.current.toggleWhileRecovering(false)).toBe(true)
      audio.dispatchEvent(new Event('loadeddata'))
    })
    expect(audio.currentTime).toBe(42)
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { retry() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    unmount()
    await act(async () => { retry() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  test('a scrubber or ±5 s seek during the hold is where the restore lands', async () => {
    const audio = new FakeAudio()
    const onUrlRefreshed = jest.fn()
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://media.test/fresh' }) })
    const { result } = renderHook(() => useAudioSessionRecovery({
      transcriptId: 't1', audioSrc: 'https://media.test/old',
      audioElement: audio as unknown as HTMLAudioElement, onUrlRefreshed,
    }))
    // Nothing is held yet: the player seeks the element itself.
    expect(result.current.seekWhileHeld(100)).toBe(false)

    act(() => { audio.dispatchEvent(new Event('error')) })
    await waitFor(() => expect(onUrlRefreshed).toHaveBeenCalled())
    expect(result.current.seekWhileHeld((held) => held + 5)).toBe(true)
    expect(result.current.seekWhileHeld((held) => held - 60)).toBe(true)
    expect(result.current.seekWhileHeld(30)).toBe(true)
    expect(result.current.seekWhileHeld((held) => held + 5)).toBe(true)
    swapSource(audio, 'loadeddata')
    expect(audio.currentTime).toBe(35)

    // Released after the restore: a later seek goes to the element again.
    expect(result.current.seekWhileHeld(10)).toBe(false)
  })

  test('a seek before any hold never becomes a later recovery position', async () => {
    const audio = new FakeAudio()
    const onUrlRefreshed = jest.fn()
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://media.test/fresh' }) })
    const { result } = renderHook(() => useAudioSessionRecovery({
      transcriptId: 't1', audioSrc: 'https://media.test/old',
      audioElement: audio as unknown as HTMLAudioElement, onUrlRefreshed,
    }))
    expect(result.current.seekWhileHeld(5)).toBe(false)
    audio.currentTime = 60
    act(() => { audio.dispatchEvent(new Event('error')) })
    await waitFor(() => expect(onUrlRefreshed).toHaveBeenCalled())
    swapSource(audio, 'loadeddata')
    expect(audio.currentTime).toBe(60)
  })
})
