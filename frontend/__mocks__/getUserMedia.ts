// Test helpers for `navigator.mediaDevices`, which jsdom does not implement.
// Used by the recording entry-condition / restart tests and anything that
// acquires a microphone.

import { createFakeStream } from './MediaRecorder'

export interface GetUserMediaMockOptions {
  /** Custom getUserMedia implementation; defaults to resolving a fake stream. */
  getUserMedia?: jest.Mock
  /** Custom enumerateDevices result; defaults to a single audioinput. */
  devices?: Array<Partial<MediaDeviceInfo>>
  /** Make the default getUserMedia reject with this DOMException-like error. */
  rejectWith?: { name: string; message?: string }
}

export interface InstalledGetUserMediaMock {
  getUserMedia: jest.Mock
  enumerateDevices: jest.Mock
  stream: MediaStream
}

const DEFAULT_DEVICES: Array<Partial<MediaDeviceInfo>> = [
  {
    kind: 'audioinput',
    deviceId: 'mock-default',
    label: 'Mock microphone',
    groupId: 'mock-group',
  },
]

export function installGetUserMediaMock(
  options: GetUserMediaMockOptions = {}
): InstalledGetUserMediaMock {
  const stream = createFakeStream()

  const getUserMedia =
    options.getUserMedia ??
    (options.rejectWith
      ? jest.fn().mockRejectedValue(
          Object.assign(new Error(options.rejectWith.message ?? options.rejectWith.name), {
            name: options.rejectWith.name,
          })
        )
      : jest.fn().mockResolvedValue(stream))

  const enumerateDevices = jest
    .fn()
    .mockResolvedValue(options.devices ?? DEFAULT_DEVICES)

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: { getUserMedia, enumerateDevices },
  })

  return { getUserMedia, enumerateDevices, stream }
}

export function resetGetUserMediaMock(): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: undefined,
  })
}
