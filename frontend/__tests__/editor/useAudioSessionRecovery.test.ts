import { renderHook, act, waitFor } from '@testing-library/react'
import { useAudioSessionRecovery } from '@/app/(app)/editor/[id]/hooks/useAudioSessionRecovery'

/** An audio element as far as the hook sees it: events, a position, play. */
class FakeAudio extends EventTarget {
  currentTime = 42
  paused = false
  error: MediaError | null = null
  play = jest.fn(() => Promise.resolve())
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
