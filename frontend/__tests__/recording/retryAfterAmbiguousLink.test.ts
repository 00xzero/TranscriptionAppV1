/**
 * A stopped recording whose upload landed but whose link to the transcript was
 * lost (and could not be checked) must be savable by Retry upload, not only by
 * reloading the page. Runs the real session and the real capture upload against
 * a small fake of the server: the create route dedupes on upload_intent_id, and
 * storage refuses to replace an object unless asked to (`upsert`), as Supabase does.
 */

type DbError = { code: string; message: string }

const server = {
  transcripts: new Map<string, { id: string; uploadIntentId: string | null; sourceObjectKey: string | null }>(),
  objects: new Map<string, number>(),
  uploads: [] as Array<{ path: string; upsert: boolean; result: 'stored' | 'already exists' }>,
  // Network faults for the browser's direct PostgREST calls, consumed in order.
  failNextLink: 0,
  failNextRead: 0,
}

const NETWORK_DROP: DbError = { code: '', message: 'TypeError: Failed to fetch' }

function fakeSupabase() {
  return {
    storage: {
      from: () => ({
        upload: async (path: string, file: File, opts: { upsert?: boolean }) => {
          const upsert = opts?.upsert === true
          if (server.objects.has(path) && !upsert) {
            server.uploads.push({ path, upsert, result: 'already exists' })
            return { data: null, error: { message: 'The resource already exists', statusCode: '409' } }
          }
          server.objects.set(path, file.size)
          server.uploads.push({ path, upsert, result: 'stored' })
          return { data: { path }, error: null }
        },
        remove: async (paths: string[]) => {
          paths.forEach((p) => server.objects.delete(p))
          return { data: [], error: null }
        },
      }),
    },
    from: () => ({
      update: (patch: { source_object_key: string }) => ({
        eq: (_col: string, id: string) => {
          const single = async () => {
            if (server.failNextLink > 0) {
              // The request never reached the database: nothing was written.
              server.failNextLink--
              return { data: null, error: NETWORK_DROP }
            }
            const row = server.transcripts.get(id)
            if (!row) return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
            row.sourceObjectKey = patch.source_object_key
            return { data: { id }, error: null }
          }
          return { select: () => ({ single, abortSignal: () => ({ single }) }) }
        },
      }),
      select: (columns: string) => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            if (server.failNextRead > 0) {
              server.failNextRead--
              return { data: null, error: NETWORK_DROP }
            }
            const row = server.transcripts.get(id)
            if (!row) return { data: null, error: null }
            return columns === 'id'
              ? { data: { id: row.id }, error: null }
              : { data: { source_object_key: row.sourceObjectKey }, error: null }
          },
        }),
      }),
    }),
  }
}

jest.mock('@/infra/supabase/client', () => ({
  createClientForUser: () => fakeSupabase(),
  createClient: () => fakeSupabase(),
}))

jest.mock('@/infra/workos/access-token', () => ({
  getAccessToken: jest.fn(async () => 'token-for-user-123'),
  notifyAccountChanged: jest.fn(),
}))

jest.mock('@/lib/transcripts/delete-client', () => ({
  deleteTranscriptRequest: jest.fn(async () => undefined),
}))

import {
  __resetForTesting,
  attachAndStart,
  getSnapshot,
  recordChunk,
  retryFinalizedUpload,
  runRecoveryProbe,
  saveRecovered,
  stopAndFinalize,
} from '@/lib/recording/session'
import { setIdentity } from '@/lib/recording/sessionIdentity'
import {
  FakeMediaRecorder,
  createFakeStream,
  dispatchChunk,
  installMediaRecorderMock,
} from '@/__mocks__/MediaRecorder'
import { __setPersistenceForTesting, InMemorySessionPersistence } from '@/lib/recording/persistence'
import { __setSessionLockForTesting, FakeSessionLock } from '@/lib/recording/lock'
import { DEFAULT_TRANSCRIPTION_OPTIONS } from '@/contracts/transcription-options'

function jsonResponse(status: number, body: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone: () => res,
  }
  return res
}

// The two API routes the upload calls: create (deduped on upload_intent_id) and start.
async function fakeFetch(url: string, init: RequestInit) {
  if (url === '/api/transcripts') {
    const body = JSON.parse(String(init.body)) as { filename: string; upload_intent_id?: string }
    const existing = [...server.transcripts.values()].find(
      (t) => body.upload_intent_id && t.uploadIntentId === body.upload_intent_id
    )
    const row = existing ?? {
      id: `transcript-${server.transcripts.size + 1}`,
      uploadIntentId: body.upload_intent_id ?? null,
      sourceObjectKey: null,
    }
    server.transcripts.set(row.id, row)
    return jsonResponse(200, {
      transcript: { id: row.id },
      storagePath: `user-123/${row.id}/${body.filename}`,
      deduped: existing !== undefined,
      sourceObjectKey: row.sourceObjectKey,
      status: 'created',
    })
  }
  if (/^\/api\/transcripts\/[^/]+\/start$/.test(url)) {
    return jsonResponse(200, { message: 'ok', jobId: 'job-1' })
  }
  throw new Error(`unexpected fetch ${url}`)
}

async function recordAndStop(): Promise<void> {
  await attachAndStart({
    stream: createFakeStream(),
    codec: { mime: 'audio/webm', extension: 'webm' },
    title: 'Interview',
    keyTerms: [],
    transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
    projectId: null,
    deviceId: null,
    maxBytes: 1024 * 1024,
  })
  recordChunk(new Blob([new Uint8Array(4096)]))
  const startedAt = getSnapshot().startedAt ?? 1_000_000
  jest.spyOn(Date, 'now').mockReturnValue(startedAt + 3_000)
  const stopping = stopAndFinalize()
  const recorder = FakeMediaRecorder.lastInstance as FakeMediaRecorder
  dispatchChunk(recorder, 512)
  dispatchChunk(recorder, 0)
  await stopping
}

function screen() {
  const s = getSnapshot()
  return s.state === 'error'
    ? { state: s.state, errorMessage: s.errorMessage, canRetryUpload: s.canRetryUpload }
    : { state: s.state }
}

describe('Retry upload after an ambiguous media link failure', () => {
  let persistence: InMemorySessionPersistence

  beforeEach(() => {
    server.transcripts.clear()
    server.objects.clear()
    server.uploads = []
    server.failNextLink = 0
    server.failNextRead = 0
    __resetForTesting()
    installMediaRecorderMock()
    FakeMediaRecorder.autoDispatchStop = true
    setIdentity({ userId: 'user-123', ready: true })
    persistence = new InMemorySessionPersistence()
    __setPersistenceForTesting(persistence)
    ;(global as unknown as { fetch: typeof fakeFetch }).fetch = fakeFetch
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('the network drops after the upload; Retry upload then saves the recording', async () => {
    // First attempt: the file reaches storage, then the link and its check both fail.
    server.failNextLink = 1
    server.failNextRead = 1
    await recordAndStop()

    expect(screen()).toEqual({
      state: 'error',
      errorMessage:
        'Failed to update transcript: TypeError: Failed to fetch; ' +
        'reconciliation failed: TypeError: Failed to fetch',
      canRetryUpload: true,
    })
    // Kept on purpose: the file in storage and a transcript row with no file linked.
    expect([...server.objects.keys()]).toEqual([expect.stringMatching(/^user-123\/transcript-1\/recording-.+\.webm$/)])
    expect(server.transcripts.get('transcript-1')?.sourceObjectKey).toBeNull()

    // The network is back. The person presses Retry upload, up to three times.
    const afterEachRetry: ReturnType<typeof screen>[] = []
    for (let press = 0; press < 3 && getSnapshot().state === 'error'; press++) {
      await retryFinalizedUpload()
      afterEachRetry.push(screen())
    }

    expect(afterEachRetry).toEqual([{ state: 'submitted' }])
    expect(server.transcripts.size).toBe(1)
    expect(server.transcripts.get('transcript-1')?.sourceObjectKey).toMatch(/^user-123\/transcript-1\//)
  })

  test('a page reload (crash recovery) saves the same recording', async () => {
    server.failNextLink = 1
    server.failNextRead = 1
    await recordAndStop()
    expect(getSnapshot().state).toBe('error')

    // Reload: the in-memory session and its locks are gone; the recording is still in IndexedDB.
    __resetForTesting()
    __setPersistenceForTesting(persistence)
    __setSessionLockForTesting(new FakeSessionLock())
    setIdentity({ userId: 'user-123', ready: true })
    expect(await runRecoveryProbe()).toBe(true)

    await expect(saveRecovered('Interview')).resolves.toMatchObject({ ok: true })
    expect(screen()).toEqual({ state: 'submitted' })
    expect(server.transcripts.get('transcript-1')?.sourceObjectKey).toMatch(/^user-123\/transcript-1\//)
  })
})
