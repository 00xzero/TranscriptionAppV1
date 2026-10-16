/** @jest-environment node */

import { existsSync, ReadStream } from 'node:fs'
import { truncate, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

const prepareAudioFileMock = jest.fn()
const probeSourceMediaMock = jest.fn()
const uploadMock = jest.fn()
let uploadSignal: AbortSignal | null = null

jest.mock('@/lib/audio/ffmpeg', () => {
    class ProcessTimeoutError extends Error {
        constructor(command: string, timeoutMs: number) {
            super(`${command} timed out after ${timeoutMs}ms`)
            this.name = 'ProcessTimeoutError'
        }
    }
    return {
        ProcessTimeoutError,
        prepareAudioFile: (...args: unknown[]) => prepareAudioFileMock(...args),
        probeSourceMedia: (...args: unknown[]) => probeSourceMediaMock(...args),
    }
})

jest.mock('@/infra/supabase/admin', () => ({
    createAbortableAdminClient: (signal: AbortSignal) => {
        uploadSignal = signal
        return { storage: { from: () => ({ upload: uploadMock }) } }
    },
}))

jest.mock('@/infra/supabase/storage', () => ({
    MEDIA_BUCKET: 'media',
    getSignedMediaUrl: jest.fn(async () => ({ url: 'https://storage.test/source', error: null })),
    isMissingStorageObjectError: () => false,
}))

import { ProcessTimeoutError } from '@/lib/audio/ffmpeg'
import { decidePreparation, MAX_OUTPUT_BYTES, type SourceProbe } from '@/core/media/prepare-policy'
import {
    claimWaveform,
    convertAndUpload,
    linkPrepared,
    loadSource,
    PREPARE_START_LIMIT_MS,
    removeOriginal,
    settleUnlinked,
} from '@/lib/media/prepare-steps'

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the admin client: the query chains the steps
// use, plus switches for the failures that matter (a write that commits but
// whose answer is lost, a read that fails).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type Filter = [string, unknown]

class FakeAdmin {
    tables: Record<string, Map<string, Row>> = { jobs: new Map(), transcripts: new Map() }
    objects = new Set<string>()
    removed: string[] = []
    /** 'lost': the update commits but answers with an error. 'fail': it does not commit. */
    nextUpdate: 'ok' | 'lost' | 'fail' = 'ok'
    /** Reads of these tables fail. */
    failingReads = new Set<string>()
    /** Fail only the reads after the first n of transcripts. */
    transcriptReadsBeforeFailure: number | null = null
    private transcriptReads = 0

    from(table: string) {
        return new FakeQuery(this, table)
    }

    readFails(table: string): boolean {
        if (this.failingReads.has(table)) return true
        if (table === 'transcripts' && this.transcriptReadsBeforeFailure !== null) {
            this.transcriptReads += 1
            return this.transcriptReads > this.transcriptReadsBeforeFailure
        }
        return false
    }

    storage = {
        from: () => ({
            remove: async (keys: string[]) => {
                for (const key of keys) {
                    this.objects.delete(key)
                    this.removed.push(key)
                }
                return { data: keys.map((name) => ({ name })), error: null }
            },
        }),
    }

    asClient(): SupabaseClient {
        return this as unknown as SupabaseClient
    }
}

class FakeQuery implements PromiseLike<{ data: Row | null; error: { message: string } | null }> {
    private filters: Filter[] = []
    private patch: Row | null = null
    private returning = false

    constructor(private db: FakeAdmin, private table: string) {}

    select() {
        if (this.patch) this.returning = true
        return this
    }
    update(patch: Row) {
        this.patch = patch
        return this
    }
    eq(column: string, value: unknown) {
        this.filters.push([column, value])
        return this
    }
    maybeSingle() {
        return Promise.resolve(this.run())
    }
    then<A, B>(
        onfulfilled?: ((value: { data: Row | null; error: { message: string } | null }) => A | PromiseLike<A>) | null,
        onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
    ) {
        return Promise.resolve(this.run()).then(onfulfilled, onrejected)
    }

    private matches(): Row[] {
        return [...this.db.tables[this.table].values()].filter((row) =>
            this.filters.every(([column, value]) => row[column] === value)
        )
    }

    private run(): { data: Row | null; error: { message: string } | null } {
        if (!this.patch) {
            if (this.db.readFails(this.table)) return { data: null, error: { message: 'read failed' } }
            return { data: this.matches()[0] ?? null, error: null }
        }
        const mode = this.db.nextUpdate
        this.db.nextUpdate = 'ok'
        if (mode === 'fail') return { data: null, error: { message: 'write failed' } }
        const rows = this.matches()
        for (const row of rows) Object.assign(row, this.patch)
        if (mode === 'lost') return { data: null, error: { message: 'response lost' } }
        return { data: this.returning ? rows[0] ?? null : null, error: null }
    }
}

const transcriptId = '11111111-1111-4111-8111-111111111111'
const jobId = '33333333-3333-4333-8333-333333333333'
const userId = '22222222-2222-4222-8222-222222222222'
const sourceKey = `${userId}/${transcriptId}/call.m4a`
const preparedKey = `${userId}/${transcriptId}/${jobId}.m4a`
const ids = { transcriptId, jobId }

function setup(overrides: { jobStatus?: string; sourceObjectKey?: string | null; waveformStatus?: string; waitedMs?: number } = {}) {
    const db = new FakeAdmin()
    db.tables.jobs.set(jobId, {
        id: jobId,
        transcript_id: transcriptId,
        status: overrides.jobStatus ?? 'queued',
        created_at: new Date(Date.now() - (overrides.waitedMs ?? 0)).toISOString(),
    })
    db.tables.transcripts.set(transcriptId, {
        id: transcriptId,
        user_id: userId,
        source_object_key: overrides.sourceObjectKey === undefined ? sourceKey : overrides.sourceObjectKey,
        waveform_status: overrides.waveformStatus ?? 'skipped',
    })
    db.objects.add(sourceKey)
    db.objects.add(preparedKey)
    return db
}

function keyOf(db: FakeAdmin) {
    return db.tables.transcripts.get(transcriptId)?.source_object_key
}

describe('loadSource', () => {
    test('a settled waveform leaves the file free to prepare', async () => {
        const db = setup({ waveformStatus: 'ready' })
        await expect(loadSource(db.asClient(), { ...ids, userId })).resolves.toEqual({ proceed: true, sourceKey, skip: null })
    })

    test.each(['pending', 'processing'])('a %s waveform marks the file busy', async (waveformStatus) => {
        const db = setup({ waveformStatus })
        await expect(loadSource(db.asClient(), { ...ids, userId })).resolves.toEqual({ proceed: true, sourceKey, skip: 'waveform_busy' })
    })

    test('a job that waited in line past the limit keeps its upload as it is', async () => {
        const db = setup({ waitedMs: PREPARE_START_LIMIT_MS + 1000 })
        await expect(loadSource(db.asClient(), { ...ids, userId })).resolves.toEqual({ proceed: true, sourceKey, skip: 'waited_too_long' })
    })

    test('a row of another user, or without media in its folder, is an invalid source', async () => {
        await expect(loadSource(setup().asClient(), { ...ids, userId: 'someone-else' }))
            .resolves.toEqual({ proceed: false, reason: 'invalid_source' })
        const db = setup()
        db.tables.transcripts.get(transcriptId)!.source_object_key = 'elsewhere/file.webm'
        await expect(loadSource(db.asClient(), { ...ids, userId }))
            .resolves.toEqual({ proceed: false, reason: 'invalid_source' })
    })

    test('a job no longer queued stops the run', async () => {
        const db = setup({ jobStatus: 'error' })
        await expect(loadSource(db.asClient(), { ...ids, userId })).resolves.toEqual({ proceed: false, reason: 'job_not_current' })
    })
})

describe('linkPrepared', () => {
    test('swaps the key from the original to the prepared file', async () => {
        const db = setup()
        await expect(linkPrepared(db.asClient(), { ...ids, sourceKey, preparedKey })).resolves.toEqual({ outcome: 'linked' })
        expect(keyOf(db)).toBe(preparedKey)
        expect(db.removed).toEqual([])
    })

    test('a swap that committed but lost its answer counts as linked and deletes nothing', async () => {
        const db = setup()
        db.nextUpdate = 'lost'
        await expect(linkPrepared(db.asClient(), { ...ids, sourceKey, preparedKey })).resolves.toEqual({ outcome: 'linked' })
        expect(keyOf(db)).toBe(preparedKey)
        expect(db.removed).toEqual([])
    })

    test('a swap that did not commit is retried, keeping the prepared file', async () => {
        const db = setup()
        db.nextUpdate = 'fail'
        await expect(linkPrepared(db.asClient(), { ...ids, sourceKey, preparedKey })).rejects.toThrow('write failed')
        expect(keyOf(db)).toBe(sourceKey)
        expect(db.removed).toEqual([])
    })

    test('a row now pointing elsewhere removes the prepared file', async () => {
        const db = setup({ sourceObjectKey: `${userId}/${transcriptId}/other.m4a` })
        await expect(linkPrepared(db.asClient(), { ...ids, sourceKey, preparedKey })).resolves.toEqual({ outcome: 'superseded' })
        expect(db.removed).toEqual([preparedKey])
    })

    test('a gone transcript removes the prepared file', async () => {
        const db = setup()
        db.tables.transcripts.delete(transcriptId)
        await expect(linkPrepared(db.asClient(), { ...ids, sourceKey, preparedKey })).resolves.toEqual({ outcome: 'gone' })
        expect(db.removed).toEqual([preparedKey])
    })

    test('when the re-read fails, the prepared file is kept and the step throws', async () => {
        const db = setup()
        db.nextUpdate = 'fail'
        db.transcriptReadsBeforeFailure = 0
        await expect(linkPrepared(db.asClient(), { ...ids, sourceKey, preparedKey })).rejects.toThrow('read failed')
        expect(db.removed).toEqual([])
    })

    test('a job that is no longer queued does not swap, and removes the unlinked file', async () => {
        const db = setup({ jobStatus: 'error' })
        await expect(linkPrepared(db.asClient(), { ...ids, sourceKey, preparedKey })).resolves.toEqual({ outcome: 'not_current' })
        expect(keyOf(db)).toBe(sourceKey)
        expect(db.removed).toEqual([preparedKey])
    })

    test('a duplicate run after the first one linked converges without deleting the linked file', async () => {
        const db = setup()
        await linkPrepared(db.asClient(), { ...ids, sourceKey, preparedKey })
        await expect(linkPrepared(db.asClient(), { ...ids, sourceKey, preparedKey })).resolves.toEqual({ outcome: 'linked' })
        await expect(removeOriginal(db.asClient(), { transcriptId, sourceKey, preparedKey })).resolves.toBe('removed')
        await expect(removeOriginal(db.asClient(), { transcriptId, sourceKey, preparedKey })).resolves.toBe('removed')
        expect(db.removed).toEqual([sourceKey, sourceKey])
        expect(db.objects.has(preparedKey)).toBe(true)
    })
})

describe('removeOriginal', () => {
    test('deletes the original only once the row points at the prepared file', async () => {
        const db = setup()
        await expect(removeOriginal(db.asClient(), { transcriptId, sourceKey, preparedKey })).resolves.toBe('skipped')
        expect(db.removed).toEqual([])
        db.tables.transcripts.get(transcriptId)!.source_object_key = preparedKey
        await expect(removeOriginal(db.asClient(), { transcriptId, sourceKey, preparedKey })).resolves.toBe('removed')
        expect(db.removed).toEqual([sourceKey])
    })
})

describe('settleUnlinked', () => {
    test('the row pointing at the prepared file means go on with it', async () => {
        const db = setup({ sourceObjectKey: preparedKey })
        await expect(settleUnlinked(db.asClient(), { transcriptId, sourceKey, preparedKey })).resolves.toBe('prepared')
        expect(db.removed).toEqual([])
    })

    test('the row still on the original removes the partial upload', async () => {
        const db = setup()
        await expect(settleUnlinked(db.asClient(), { transcriptId, sourceKey, preparedKey })).resolves.toBe('original')
        expect(db.removed).toEqual([preparedKey])
    })

    test('a row now pointing elsewhere removes the upload and reports it superseded', async () => {
        const db = setup({ sourceObjectKey: `${userId}/${transcriptId}/other.m4a` })
        await expect(settleUnlinked(db.asClient(), { transcriptId, sourceKey, preparedKey })).resolves.toBe('superseded')
        expect(db.removed).toEqual([preparedKey])
    })

    test('a gone row removes the upload and stops', async () => {
        const db = setup()
        db.tables.transcripts.delete(transcriptId)
        await expect(settleUnlinked(db.asClient(), { transcriptId, sourceKey, preparedKey })).resolves.toBe('gone')
        expect(db.removed).toEqual([preparedKey])
    })

    test('a failed read keeps every file and throws', async () => {
        const db = setup()
        db.failingReads.add('transcripts')
        await expect(settleUnlinked(db.asClient(), { transcriptId, sourceKey, preparedKey })).rejects.toThrow('read failed')
        expect(db.removed).toEqual([])
    })
})

describe('claimWaveform', () => {
    test('claims a skipped waveform for the final file', async () => {
        const db = setup({ sourceObjectKey: preparedKey })
        await expect(claimWaveform(db.asClient(), ids)).resolves.toEqual({ dispatch: true, sourceObjectKey: preparedKey })
        expect(db.tables.transcripts.get(transcriptId)!.waveform_status).toBe('pending')
    })

    test('still dispatches after Deepgram has moved the job to processing', async () => {
        const db = setup({ jobStatus: 'processing' })
        await expect(claimWaveform(db.asClient(), ids)).resolves.toEqual({ dispatch: true, sourceObjectKey: sourceKey })
    })

    test('a claim that committed but lost its answer still dispatches on retry', async () => {
        const db = setup()
        db.nextUpdate = 'lost'
        await expect(claimWaveform(db.asClient(), ids)).resolves.toEqual({ dispatch: true, sourceObjectKey: sourceKey })
        // The retry finds `pending` and treats it as its own claim.
        await expect(claimWaveform(db.asClient(), ids)).resolves.toEqual({ dispatch: true, sourceObjectKey: sourceKey })
    })

    test.each(['processing', 'ready', 'error'])('does not dispatch a waveform already %s', async (waveformStatus) => {
        const db = setup({ waveformStatus })
        await expect(claimWaveform(db.asClient(), ids)).resolves.toEqual({ dispatch: false })
    })

    test('does not dispatch for a failed job', async () => {
        const db = setup({ jobStatus: 'error' })
        await expect(claimWaveform(db.asClient(), ids)).resolves.toEqual({ dispatch: false })
        expect(db.tables.transcripts.get(transcriptId)!.waveform_status).toBe('skipped')
    })
})

describe('convertAndUpload', () => {
    const MB = 1024 * 1024
    const probe: SourceProbe = {
        audioStreamCount: 1,
        hasVideo: false,
        audioCodec: 'aac',
        audioBitRate: 130_000,
        channels: 2,
        sampleRate: 48_000,
        sizeBytes: 58 * MB,
        audioDurationSeconds: 3600,
    }
    const decision = decidePreparation(probe)
    if (decision.action === 'keep') throw new Error('fixture must be repacked')
    let outDir: string | null = null

    function writesOutput(bytes: number) {
        prepareAudioFileMock.mockImplementation(async (_url: string, outPath: string) => {
            outDir = dirname(outPath)
            // A sparse file: the right size without writing 200 MB.
            await writeFile(outPath, '')
            await truncate(outPath, bytes)
        })
    }

    beforeEach(() => {
        jest.clearAllMocks()
        outDir = null
        uploadSignal = null
        writesOutput(28 * MB)
        probeSourceMediaMock.mockResolvedValue({ ...probe, audioDurationSeconds: 3600.02 })
        uploadMock.mockResolvedValue({ data: { path: preparedKey }, error: null })
    })

    const run = (db: FakeAdmin, now?: () => number) =>
        convertAndUpload(db.asClient(), { ...ids, sourceKey, preparedKey, probe, decision, now })

    test('converts, checks and uploads the prepared file, then clears its temp folder', async () => {
        await expect(run(setup())).resolves.toEqual({ outcome: 'uploaded' })
        expect(prepareAudioFileMock).toHaveBeenCalledWith(
            'https://storage.test/source',
            expect.stringMatching(/media-prepare-.*prepared\.m4a$/),
            { kind: 'transcode', sampleRate: 48_000 },
            { timeoutMs: 150_000, maxBytes: MAX_OUTPUT_BYTES }
        )
        expect(uploadMock).toHaveBeenCalledWith(preparedKey, expect.any(ReadStream), { contentType: 'audio/mp4', upsert: true })
        expect(outDir && existsSync(outDir)).toBe(false)
    })

    test('a job no longer queued converts nothing', async () => {
        await expect(run(setup({ jobStatus: 'error' }))).resolves.toEqual({ outcome: 'not_current' })
        expect(prepareAudioFileMock).not.toHaveBeenCalled()
    })

    test('an ffmpeg timeout falls back without uploading', async () => {
        prepareAudioFileMock.mockRejectedValue(new ProcessTimeoutError('ffmpeg-prepare', 150_000))
        await expect(run(setup())).resolves.toEqual({ outcome: 'rejected', reason: 'convert_timeout' })
        expect(uploadMock).not.toHaveBeenCalled()
    })

    test('a job that has waited in line past the limit converts nothing', async () => {
        await expect(run(setup({ waitedMs: PREPARE_START_LIMIT_MS + 1000 }))).resolves.toEqual({ outcome: 'rejected', reason: 'waited_too_long' })
        expect(prepareAudioFileMock).not.toHaveBeenCalled()
    })

    test('an output that hit the 200 MB ceiling is rejected', async () => {
        writesOutput(MAX_OUTPUT_BYTES)
        const big = { ...probe, sizeBytes: 600 * MB }
        await expect(
            convertAndUpload(setup().asClient(), { ...ids, sourceKey, preparedKey, probe: big, decision })
        ).resolves.toMatchObject({ outcome: 'rejected', reason: 'hit_ceiling' })
        expect(uploadMock).not.toHaveBeenCalled()
    })

    test('an output over 75% of the original is rejected', async () => {
        writesOutput(50 * MB)
        await expect(run(setup())).resolves.toMatchObject({ outcome: 'rejected', reason: 'not_worth_it' })
    })

    test('an output whose duration does not match is rejected', async () => {
        probeSourceMediaMock.mockResolvedValue({ ...probe, audioDurationSeconds: 3500 })
        await expect(run(setup())).resolves.toMatchObject({ outcome: 'rejected', reason: 'duration_mismatch' })
    })

    test('an upload still running at the deadline is aborted and may have landed', async () => {
        uploadMock.mockImplementation(() => new Promise((resolve) => {
            uploadSignal!.addEventListener('abort', () => resolve({ data: null, error: { message: 'aborted' } }))
        }))
        let calls = 0
        // The step starts at t=0 (deadline 270 s); by the upload it is 10 ms short of it.
        const now = () => (calls++ === 0 ? 0 : 269_990)
        await expect(run(setup(), now)).resolves.toEqual({ outcome: 'rejected', reason: 'upload_timeout' })
        expect(uploadSignal!.aborted).toBe(true)
    })

    test('a failed upload throws so the step retries', async () => {
        uploadMock.mockResolvedValue({ data: null, error: { message: 'gateway timeout' } })
        await expect(run(setup())).rejects.toThrow('gateway timeout')
        expect(outDir && existsSync(outDir)).toBe(false)
    })
})
