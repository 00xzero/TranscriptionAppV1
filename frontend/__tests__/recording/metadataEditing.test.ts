jest.mock('@/lib/capture/upload', () => ({ runCaptureUpload: jest.fn() }))

import {
  __resetForTesting,
  attachAndStart,
  generateRecordingTitle,
  getSnapshot,
  updateSessionKeyTerms,
  updateSessionTitle,
} from '@/lib/recording/session'
import {
  FakeRecordingPresence,
  __setOwnerClientIdForTesting,
  __setPresenceForTesting,
} from '@/lib/recording/presence'
import { FakeOwnerLock, __setOwnerLockForTesting } from '@/lib/recording/lock'
import {
  InMemorySessionPersistence,
  __setPersistenceForTesting,
} from '@/lib/recording/persistence'
import {
  createFakeStream,
  installMediaRecorderMock,
} from '@/__mocks__/MediaRecorder'
import { setIdentity } from '@/lib/recording/sessionIdentity'
import { mockRecordingSession } from '@/__mocks__/recording-session'

const CODEC = { mime: 'audio/webm', extension: 'webm' as const }
const flush = () => new Promise((r) => setTimeout(r, 0))

// ---------------------------------------------------------------------------
// Snapshot-level behavior (no persistence/presence wiring needed).
// ---------------------------------------------------------------------------
describe('session metadata edit — snapshot behavior', () => {
  beforeEach(() => {
    __resetForTesting()
  })

  test('updateSessionTitle stores a trimmed title while recording', () => {
    mockRecordingSession({ state: 'recording', title: 'Old' })
    updateSessionTitle('  New title  ')
    expect(getSnapshot().title).toBe('New title')
  })

  test('clearing the title restores a generated fallback when none exists', () => {
    const startedAt = new Date('2026-07-05T09:15:00Z').getTime()
    const editedAt = new Date('2026-07-05T10:45:00Z').getTime()
    jest.spyOn(Date, 'now').mockReturnValue(editedAt)
    mockRecordingSession({
      state: 'recording',
      title: 'Old',
      generatedTitle: null,
      startedAt,
    })
    updateSessionTitle('   ')
    const snap = getSnapshot()
    expect(snap.title).toBeNull()
    expect(snap.generatedTitle).toBe(generateRecordingTitle(startedAt))
    expect(snap.generatedTitle).not.toBe(generateRecordingTitle(editedAt))
  })

  test('clearing the title keeps an existing generated fallback', () => {
    mockRecordingSession({
      state: 'recording',
      title: 'Old',
      generatedTitle: 'Recording — earlier',
    })
    updateSessionTitle(null)
    expect(getSnapshot().title).toBeNull()
    expect(getSnapshot().generatedTitle).toBe('Recording — earlier')
  })

  test('updateSessionKeyTerms replaces the list while paused', () => {
    mockRecordingSession({ state: 'paused', keyTerms: ['old'] })
    updateSessionKeyTerms(['Alpha', 'Beta'])
    expect(getSnapshot().keyTerms).toEqual(['Alpha', 'Beta'])
  })

  test.each(['finalizing', 'uploading'] as const)(
    'both edits are no-ops in %s state',
    (state) => {
      mockRecordingSession({ state, title: 'Keep', keyTerms: ['orig'] })
      updateSessionTitle('Nope')
      updateSessionKeyTerms(['x'])
      expect(getSnapshot().title).toBe('Keep')
      expect(getSnapshot().keyTerms).toEqual(['orig'])
    }
  )
})

// ---------------------------------------------------------------------------
// Full harness: durable persistence + same-browser presence.
// ---------------------------------------------------------------------------
describe('session metadata edit — persistence & presence', () => {
  let channel: FakeRecordingPresence
  let persistence: InMemorySessionPersistence

  beforeEach(() => {
    __resetForTesting()
    installMediaRecorderMock()
    channel = new FakeRecordingPresence()
    __setPresenceForTesting(channel)
    __setOwnerLockForTesting(new FakeOwnerLock(false))
    __setOwnerClientIdForTesting('tab-me')
    persistence = new InMemorySessionPersistence()
    __setPersistenceForTesting(persistence)
    setIdentity({ userId: 'user-1', ready: true })
  })

  afterEach(() => {
    __setPresenceForTesting(null)
    __setPersistenceForTesting(null)
    jest.restoreAllMocks()
  })

  const attach = () =>
    attachAndStart({
      stream: createFakeStream(),
      codec: CODEC,
      title: 'Original',
      keyTerms: [],
      deviceId: null,
      maxBytes: 1024 * 1024,
    })

  test('title edit persists to the durable row and republishes presence', async () => {
    await attach()
    const publishSpy = jest.spyOn(channel, 'publish')

    updateSessionTitle('Renamed')

    expect(getSnapshot().title).toBe('Renamed')
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(channel.read()?.title).toBe('Renamed')

    await flush()
    const [row] = await persistence.listSessions()
    expect(row.title).toBe('Renamed')
  })

  test('key-terms edit persists but does not republish presence', async () => {
    await attach()
    const publishSpy = jest.spyOn(channel, 'publish')

    updateSessionKeyTerms(['Alpha', 'Beta'])

    expect(getSnapshot().keyTerms).toEqual(['Alpha', 'Beta'])
    expect(publishSpy).not.toHaveBeenCalled()

    await flush()
    const [row] = await persistence.listSessions()
    expect(row.keyTerms).toEqual(['Alpha', 'Beta'])
  })
})
