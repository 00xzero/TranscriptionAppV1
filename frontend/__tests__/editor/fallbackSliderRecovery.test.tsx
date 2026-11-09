import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEditorPlayback } from '@/app/(app)/editor/[id]/hooks/useEditorPlayback'
import { pageAccountFetch } from '@/lib/auth/account-bound-fetch'

jest.mock('@/lib/auth/account-bound-fetch', () => ({ pageAccountFetch: jest.fn() }))

const AudioPlayer = jest.requireActual<typeof import('@/components/AudioPlayer')>('@/components/AudioPlayer').default

const noop = () => undefined
const keepExpanded = () => false

function FallbackPlayer() {
  const [audioSrc, setAudioSrc] = useState<string | null>('initial.mp3')
  const {
    handleAudioPlayerRef,
    handleAudioReady,
    handleTimeUpdate,
    handleSeeked,
    handleAudioDurationChange,
    handleFallbackKeyboardSeek,
  } = useEditorPlayback({
    transcriptId: 'transcript',
    audioSrc,
    setAudioSrc,
    setStatus: noop,
    onAudioTick: noop,
    startSeek: noop,
    previewSeek: noop,
    commitSeek: noop,
    onWordSeek: noop,
    onSegmentSeek: noop,
    setWaveformCollapsed: noop,
    shouldCollapseWaveform: keepExpanded,
  })

  return (
    <AudioPlayer
      ref={handleAudioPlayerRef}
      src={audioSrc!}
      onReady={handleAudioReady}
      onTimeUpdate={handleTimeUpdate}
      onSeeked={handleSeeked}
      onDurationChange={handleAudioDurationChange}
      onKeyboardSeek={handleFallbackKeyboardSeek}
      hideControls
    />
  )
}

it.each([
  ['End', 60],
  ['Home', 0],
] as const)('keeps the fallback slider %s seek when the refreshed audio loads', async (key, target) => {
  let respond!: (response: Response) => void
  jest.mocked(pageAccountFetch).mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
  const { container } = render(<FallbackPlayer />)
  const audio = container.querySelector('audio')!
  let mediaError: MediaError | null = null
  Object.defineProperties(audio, {
    duration: { configurable: true, value: 60 },
    currentTime: { configurable: true, writable: true, value: 42 },
    error: { configurable: true, get: () => mediaError },
  })
  fireEvent.loadedMetadata(audio)

  mediaError = { code: 2, message: 'Network error' } as MediaError
  fireEvent.error(audio)
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Audio progress' }), { key })
  expect(audio.currentTime).toBe(target)

  await act(async () => {
    respond({ ok: true, json: async () => ({ url: 'refreshed.mp3' }) } as Response)
  })
  expect(audio.getAttribute('src')).toBe('refreshed.mp3')
  mediaError = null
  audio.currentTime = 0
  fireEvent.loadStart(audio)
  fireEvent.loadedMetadata(audio)
  fireEvent.loadedData(audio)

  expect(audio.currentTime).toBe(target)
})
