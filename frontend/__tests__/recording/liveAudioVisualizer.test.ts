import { calculateBarData } from '@/components/RecordingSession/LiveAudioVisualizer'
import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { LiveAudioVisualizer } from '@/components/RecordingSession/LiveAudioVisualizer'

const originalAudioContext = window.AudioContext
const originalWebkitAudioContext = (
  window as unknown as { webkitAudioContext?: typeof AudioContext }
).webkitAudioContext

// Build a frequency array where every bin has a distinct value, so an
// accidental mirroring bug can't be masked by repeated values.
function rampFrequencyData(length = 512): Uint8Array {
  const data = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    data[i] = i % 256
  }
  return data
}

function makeRecorder(state: RecordingState): MediaRecorder {
  return {
    state,
    stream: {} as MediaStream,
  } as MediaRecorder
}

describe('LiveAudioVisualizer bar data', () => {
  test('produces a left/right symmetric (butterfly) strip', () => {
    const data = calculateBarData(rampFrequencyData(), 600, 6, 4)
    expect(data.length).toBeGreaterThan(1)
    for (let i = 0; i < Math.floor(data.length / 2); i++) {
      expect(data[i]).toBe(data[data.length - 1 - i])
    }
  })

  test('the center samples the lowest (loudest) frequency bins', () => {
    // Low bins loud, high bins silent — the center should be the tallest.
    const freq = new Uint8Array(512)
    for (let i = 0; i < 64; i++) freq[i] = 255
    const data = calculateBarData(freq, 600, 6, 4)
    const center = Math.floor(data.length / 2)
    expect(data[center]).toBeGreaterThan(data[0])
    expect(data[center]).toBeGreaterThan(data[data.length - 1])
  })

  test('handles a width too small for a full bar without crashing', () => {
    const data = calculateBarData(rampFrequencyData(), 4, 6, 4)
    expect(data.length).toBe(1)
    expect(Number.isFinite(data[0])).toBe(true)
  })
})

describe('LiveAudioVisualizer browser support', () => {
  afterEach(() => {
    ;(window as unknown as { AudioContext?: typeof AudioContext }).AudioContext =
      originalAudioContext
    ;(
      window as unknown as { webkitAudioContext?: typeof AudioContext }
    ).webkitAudioContext = originalWebkitAudioContext
    jest.restoreAllMocks()
  })

  test('uses webkitAudioContext when standard AudioContext is unavailable', async () => {
    const close = jest.fn()
    const createAnalyser = jest.fn(() => ({
      fftSize: 0,
      minDecibels: 0,
      maxDecibels: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 8,
      getByteFrequencyData: jest.fn(),
      disconnect: jest.fn(),
    }))
    const createMediaStreamSource = jest.fn(() => ({
      connect: jest.fn(),
      disconnect: jest.fn(),
    }))
    const WebkitAudioContext = jest.fn(() => ({
      state: 'running',
      close,
      createAnalyser,
      createMediaStreamSource,
    }))

    delete (window as unknown as { AudioContext?: unknown }).AudioContext
    ;(
      window as unknown as {
        webkitAudioContext?: typeof WebkitAudioContext
      }
    ).webkitAudioContext = WebkitAudioContext

    render(
      React.createElement(LiveAudioVisualizer, {
        mediaRecorder: makeRecorder('paused'),
        width: 600,
        height: 128,
        barColor: 'rgb(199, 62, 29)',
      })
    )

    await waitFor(() => expect(WebkitAudioContext).toHaveBeenCalledTimes(1))
    expect(createAnalyser).toHaveBeenCalledTimes(1)
    expect(createMediaStreamSource).toHaveBeenCalledTimes(1)
  })
})
