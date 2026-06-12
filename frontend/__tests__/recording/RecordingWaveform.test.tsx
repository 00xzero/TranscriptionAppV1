import React from 'react'
import { act, render, screen } from '@testing-library/react'
import RecordingWaveform from '@/components/RecordingSession/RecordingWaveform'
import {
  __resetForTesting,
  attachAndStart,
  forceState,
  startMock,
} from '@/lib/recording/session'
import {
  createFakeStream,
  installMediaRecorderMock,
} from '@/__mocks__/MediaRecorder'

// The real vendored LiveAudioVisualizer builds an AudioContext/AnalyserNode and
// draws to a canvas, neither of which works in jsdom. Stub it with a canvas the
// tests can detect so we can assert which branch RecordingWaveform chose.
jest.mock('@/components/RecordingSession/LiveAudioVisualizer', () => ({
  LiveAudioVisualizer: () =>
    require('react').createElement('canvas', {
      'data-testid': 'live-audio-visualizer',
    }),
}))

const CODEC = { mime: 'audio/webm', extension: 'webm' as const }

function attachLiveRecorder(): void {
  attachAndStart({
    stream: createFakeStream(),
    codec: CODEC,
    title: 't',
    keyTerms: [],
    deviceId: null,
    maxBytes: 1024 * 1024,
  })
}

describe('RecordingWaveform', () => {
  let widthSpy: jest.SpyInstance

  beforeEach(() => {
    __resetForTesting()
    installMediaRecorderMock()
    // jsdom reports clientWidth as 0; the live path needs a measured width.
    widthSpy = jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(600)
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = class {}
  })

  afterEach(() => {
    widthSpy.mockRestore()
    delete (window as unknown as { AudioContext?: unknown }).AudioContext
  })

  test('falls back to the animated mock when there is no live recorder', () => {
    act(() => {
      startMock({ title: 't' }) // recording state, but no real recorder attached
    })
    render(<RecordingWaveform />)
    expect(screen.getByTestId('recording-waveform-mock')).toBeInTheDocument()
    expect(screen.queryByTestId('live-audio-visualizer')).not.toBeInTheDocument()
  })

  test('renders the live visualizer while recording with a real recorder', () => {
    act(() => {
      attachLiveRecorder()
    })
    render(<RecordingWaveform />)
    expect(screen.getByTestId('live-audio-visualizer')).toBeInTheDocument()
    expect(screen.queryByTestId('recording-waveform-mock')).not.toBeInTheDocument()
  })

  test('keeps the live visualizer mounted while paused', () => {
    act(() => {
      attachLiveRecorder()
      forceState('paused')
    })
    render(<RecordingWaveform />)
    expect(screen.getByTestId('live-audio-visualizer')).toBeInTheDocument()
  })

  test('falls back to the mock once finalizing (no live recorder)', () => {
    act(() => {
      attachLiveRecorder()
      forceState('finalizing')
    })
    render(<RecordingWaveform />)
    expect(screen.getByTestId('recording-waveform-mock')).toBeInTheDocument()
    expect(screen.queryByTestId('live-audio-visualizer')).not.toBeInTheDocument()
  })

  test('falls back to the mock when Web Audio is unavailable', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext
    act(() => {
      attachLiveRecorder()
    })
    render(<RecordingWaveform />)
    expect(screen.getByTestId('recording-waveform-mock')).toBeInTheDocument()
    expect(screen.queryByTestId('live-audio-visualizer')).not.toBeInTheDocument()
  })
})
