jest.mock('@/lib/capture/upload', () => ({ runCaptureUpload: jest.fn() }))

import {
  __resetForTesting,
  __setSnapshotForTesting,
  attachAndStart,
  discard,
  heartbeatTick,
  pause,
  recordChunk,
} from '@/lib/recording/session'
import {
  FakeRecordingPresence,
  __setPresenceForTesting,
  __setOwnerClientIdForTesting,
} from '@/lib/recording/presence'
import { FakeOwnerLock, __setOwnerLockForTesting } from '@/lib/recording/lock'
import { InMemorySessionPersistence, __setPersistenceForTesting } from '@/lib/recording/persistence'
import { createFakeStream, installMediaRecorderMock } from '@/__mocks__/MediaRecorder'
import { setIdentity } from '@/lib/recording/sessionIdentity'

const CODEC = { mime: 'audio/webm', extension: 'webm' as const }
const START = 1_000_000

const flush = () => new Promise((r) => setTimeout(r, 0))

function attach() {
  return attachAndStart({
    stream: createFakeStream(),
    codec: CODEC,
    title: 'HB',
    keyTerms: [],
    deviceId: null,
    maxBytes: 1024 * 1024,
  })
}

describe('presence heartbeat', () => {
  let channel: FakeRecordingPresence
  let now: jest.SpyInstance<number, []>

  beforeEach(() => {
    __resetForTesting()
    installMediaRecorderMock()
    channel = new FakeRecordingPresence()
    __setPresenceForTesting(channel)
    __setOwnerLockForTesting(new FakeOwnerLock(false))
    __setOwnerClientIdForTesting('tab-me')
    setIdentity({ userId: 'user-1', ready: true })
    now = jest.spyOn(Date, 'now').mockReturnValue(START)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    __setPresenceForTesting(null)
    __setOwnerLockForTesting(null)
  })

  test('publishes presence on start with no chunk yet', async () => {
    await attach()
    const p = channel.read()
    expect(p).not.toBeNull()
    expect(p?.state).toBe('recording')
    expect(p?.userId).toBe('user-1')
    expect(p?.ownerClientId).toBe('tab-me')
    expect(p?.title).toBe('HB')
    expect(p?.lastChunkSeq).toBeNull() // nextChunkSeq === 0
  })

  test('lastChunkSeq reflects the last persisted chunk after a heartbeat', async () => {
    await attach()
    recordChunk(new Blob([new Uint8Array(64)]))
    now.mockReturnValue(START + 2_500)
    heartbeatTick(START + 2_500)
    expect(channel.read()?.lastChunkSeq).toBe(0)
  })

  test('throttles to the 2s heartbeat cadence', async () => {
    await attach()
    expect(channel.read()?.heartbeatAt).toBe(START)

    // Too soon (<2s): no republish.
    now.mockReturnValue(START + 1_000)
    heartbeatTick(START + 1_000)
    expect(channel.read()?.heartbeatAt).toBe(START)

    // >=2s since last publish: republish (Date.now drives the stamped heartbeatAt).
    now.mockReturnValue(START + 2_000)
    heartbeatTick(START + 2_000)
    expect(channel.read()?.heartbeatAt).toBe(START + 2_000)
  })

  test('keeps heartbeating through paused / finalizing / uploading', async () => {
    await attach()

    pause()
    expect(channel.read()?.state).toBe('paused')
    // A later tick while paused still republishes (regression guard: the 1s
    // interval is no longer cleared on pause/finalize).
    now.mockReturnValue(START + 5_000)
    heartbeatTick(START + 5_000)
    expect(channel.read()?.heartbeatAt).toBe(START + 5_000)

    // Force the in-flight states and confirm the heartbeat still covers them.
    __setSnapshotForTesting({ state: 'finalizing' })
    heartbeatTick(START + 8_000)
    expect(channel.read()?.state).toBe('finalizing')

    __setSnapshotForTesting({ state: 'uploading' })
    heartbeatTick(START + 11_000)
    expect(channel.read()?.state).toBe('uploading')
  })

  test('terminal cleanup clears presence after persistence and before lock release', async () => {
    const persistence = new InMemorySessionPersistence()
    __setPersistenceForTesting(persistence)
    const ownerLock = new FakeOwnerLock(false)
    __setOwnerLockForTesting(ownerLock)

    await attach()
    expect(channel.read()).not.toBeNull()

    const order: string[] = []
    jest.spyOn(persistence, 'deleteSession').mockImplementation(async () => {
      order.push('delete')
    })
    jest.spyOn(channel, 'clear').mockImplementation(() => {
      order.push('clear')
    })
    jest.spyOn(ownerLock, 'release').mockImplementation(async () => {
      order.push('release')
    })

    discard()
    await flush()

    expect(order).toEqual(['delete', 'clear', 'release'])
  })
})
