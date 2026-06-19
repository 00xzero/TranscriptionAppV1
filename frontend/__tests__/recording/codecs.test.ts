import { findCodecByMime, selectCodec } from '@/lib/recording/codecs'

const ORIGINAL_MEDIA_RECORDER = window.MediaRecorder

function installMediaRecorderSupport(supportedMimes: string[]) {
  Object.defineProperty(window, 'MediaRecorder', {
    configurable: true,
    value: {
      isTypeSupported: jest.fn((mime: string) =>
        supportedMimes.includes(mime)
      ),
    },
  })
}

describe('recording codec selection', () => {
  afterEach(() => {
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: ORIGINAL_MEDIA_RECORDER,
    })
  })

  test('prefers WebM Opus when available', () => {
    installMediaRecorderSupport(['audio/webm;codecs=opus', 'audio/mp4'])

    expect(selectCodec()).toEqual({
      mime: 'audio/webm;codecs=opus',
      extension: 'webm',
    })
  })

  test('falls back to MP4 when WebM is unavailable', () => {
    installMediaRecorderSupport(['audio/mp4'])

    expect(selectCodec()).toEqual({
      mime: 'audio/mp4',
      extension: 'mp4',
    })
  })

  test('maps supported custom MP4 MIME strings to the MP4 extension', () => {
    installMediaRecorderSupport(['audio/mp4;codecs=mp4a.40.2'])

    expect(findCodecByMime('audio/mp4;codecs=mp4a.40.2')).toEqual({
      mime: 'audio/mp4;codecs=mp4a.40.2',
      extension: 'mp4',
    })
  })
})
