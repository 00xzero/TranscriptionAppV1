import {
  FakePresenceBus,
  FakeRecordingPresence,
  parsePresence,
  type RecordingPresence,
} from '@/lib/recording/presence'

function makePresence(over: Partial<RecordingPresence> = {}): RecordingPresence {
  return {
    sessionId: 's1',
    ownerClientId: 'tab-a',
    userId: 'u1',
    state: 'recording',
    title: 'My recording',
    startedAt: 1_000,
    lastResumeAt: 1_000,
    pausedAccumulatedMs: 0,
    bytesSoFar: 2048,
    lastChunkSeq: 3,
    lastChunkReceivedAt: 1_500,
    heartbeatAt: 2_000,
    ...over,
  }
}

describe('FakeRecordingPresence', () => {
  test('publish → read round-trip and clear removes the snapshot', () => {
    const channel = new FakeRecordingPresence()
    expect(channel.read()).toBeNull()

    const presence = makePresence()
    channel.publish(presence)
    expect(channel.read()).toEqual(presence)

    channel.clear()
    expect(channel.read()).toBeNull()
  })

  test('subscribers are notified on publish and clear across shared-bus instances', () => {
    const bus = new FakePresenceBus()
    const owner = new FakeRecordingPresence(bus)
    const observer = new FakeRecordingPresence(bus)

    const listener = jest.fn()
    const unsubscribe = observer.subscribe(listener)

    owner.publish(makePresence())
    expect(listener).toHaveBeenCalledTimes(1)
    expect(observer.read()?.sessionId).toBe('s1')

    owner.clear()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(observer.read()).toBeNull()

    unsubscribe()
    owner.publish(makePresence())
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('parsePresence', () => {
  test('parses a valid snapshot', () => {
    const presence = makePresence()
    expect(parsePresence(JSON.stringify(presence))).toEqual(presence)
  })

  test('returns null for null, malformed JSON, and non-objects', () => {
    expect(parsePresence(null)).toBeNull()
    expect(parsePresence('{not json')).toBeNull()
    expect(parsePresence('42')).toBeNull()
    expect(parsePresence('"a string"')).toBeNull()
  })

  test('returns null for an old/partial schema missing required fields', () => {
    expect(parsePresence(JSON.stringify({ sessionId: 's1' }))).toBeNull()
    // Missing heartbeatAt:
    const { heartbeatAt: _omit, ...rest } = makePresence()
    expect(parsePresence(JSON.stringify(rest))).toBeNull()
  })

  test('rejects an unknown state value', () => {
    expect(parsePresence(JSON.stringify(makePresence({ state: 'idle' as never })))).toBeNull()
  })

  test('coerces absent optional fields to null', () => {
    const parsed = parsePresence(
      JSON.stringify(makePresence({ lastChunkSeq: undefined, lastResumeAt: undefined }))
    )
    expect(parsed?.lastChunkSeq).toBeNull()
    expect(parsed?.lastResumeAt).toBeNull()
  })
})
