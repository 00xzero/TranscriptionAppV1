jest.mock('@/lib/capture/upload', () => ({ runCaptureUpload: jest.fn() }))

import {
  __resetForTesting,
  attachAndStart,
  getSnapshot,
  RemoteRecordingActiveError,
} from '@/lib/recording/session'
import { FakeOwnerLock, __setOwnerLockForTesting } from '@/lib/recording/lock'
import { createFakeStream, installMediaRecorderMock } from '@/__mocks__/MediaRecorder'
import { setIdentity } from '@/lib/recording/sessionIdentity'

const CODEC = { mime: 'audio/webm', extension: 'webm' as const }

function attach() {
  return attachAndStart({
    stream: createFakeStream(),
    codec: CODEC,
    title: 'Dup',
    keyTerms: [],
    deviceId: null,
    maxBytes: 1024 * 1024,
  })
}

describe('duplicate-start blocking via the global owner lock', () => {
  beforeEach(() => {
    __resetForTesting()
    installMediaRecorderMock()
    setIdentity({ userId: 'user-1', ready: true })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('throws RemoteRecordingActiveError when another tab owns the recording', async () => {
    __setOwnerLockForTesting(new FakeOwnerLock(true))
    await expect(attach()).rejects.toBeInstanceOf(RemoteRecordingActiveError)
    // No live session was created.
    expect(getSnapshot().state).toBe('idle')
  })

  test('starts normally when the owner lock is free', async () => {
    __setOwnerLockForTesting(new FakeOwnerLock(false))
    await attach()
    expect(getSnapshot().state).toBe('recording')
  })
})
