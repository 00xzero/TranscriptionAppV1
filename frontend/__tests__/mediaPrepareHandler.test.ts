/** @jest-environment node */

import { InngestTestEngine, mockCtx } from '@inngest/test'

const steps = {
    loadSource: jest.fn(),
    decide: jest.fn(),
    convertAndUpload: jest.fn(),
    linkPrepared: jest.fn(),
    removeOriginal: jest.fn(),
    settleUnlinked: jest.fn(),
    claimWaveform: jest.fn(),
    releaseWaveformClaim: jest.fn(),
}
const jobQueuedMock = jest.fn()

jest.mock('@/lib/media/prepare-steps', () => ({
    preparedObjectKey: (userId: string, transcriptId: string, jobId: string) => `${userId}/${transcriptId}/${jobId}.m4a`,
    loadSource: (...a: unknown[]) => steps.loadSource(...a),
    decide: (...a: unknown[]) => steps.decide(...a),
    convertAndUpload: (...a: unknown[]) => steps.convertAndUpload(...a),
    linkPrepared: (...a: unknown[]) => steps.linkPrepared(...a),
    removeOriginal: (...a: unknown[]) => steps.removeOriginal(...a),
    settleUnlinked: (...a: unknown[]) => steps.settleUnlinked(...a),
    claimWaveform: (...a: unknown[]) => steps.claimWaveform(...a),
    releaseWaveformClaim: (...a: unknown[]) => steps.releaseWaveformClaim(...a),
}))
jest.mock('@/lib/inngest/job-checks', () => ({
    jobQueued: (...a: unknown[]) => jobQueuedMock(...a),
}))
jest.mock('@/infra/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { handleMediaPrepare } from '@/lib/inngest/functions/handle-media-prepare'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const sourceKey = `${userId}/${transcriptId}/call.m4a`
const preparedKey = `${userId}/${transcriptId}/${jobId}.m4a`
const event = {
    name: 'media/prepare-requested',
    data: { transcriptId, jobId, userId, keyTerms: ['Dechra'] },
} as const

const probe = { audioStreamCount: 1, hasVideo: false, attachedPictureBytes: 0, audioCodec: 'aac', audioBitRate: 130_000, channels: 2, sampleRate: 48_000, sizeBytes: 60_000_000, audioDurationSeconds: 3600 }
const transcode = { decision: { action: 'transcode', predictedBytes: 28_800_000, sampleRate: 48_000 }, probe }
const keep = { decision: { action: 'keep', reason: 'already_small' }, probe }

type MockedStep = { id: string; handler: () => unknown }

// The test engine doesn't model a step that has used up its retries: an
// unmocked step that throws halts the run, and a mocked one that throws reads
// back as undefined. Inngest's real behaviour is to throw the step's final
// error into the handler, so `failures` makes those steps' calls reject with
// it. Event sends are mocked so nothing reaches Inngest.
function execute(
    mockedSteps: MockedStep[] = [],
    failures: Record<string, string> = {},
    data: Record<string, unknown> = event.data
) {
    const engine = new InngestTestEngine({ function: handleMediaPrepare })
    return engine.execute({
        events: [{ ...event, data } as typeof event],
        steps: [
            ...mockedSteps,
            { id: 'request-transcription', handler: () => ({ ids: ['t'] }) },
            { id: 'request-waveform', handler: () => ({ ids: ['w'] }) },
            { id: 'fail-superseded', handler: () => ({ ids: ['f'] }) },
            { id: 'fail-invalid_source', handler: () => ({ ids: ['f'] }) },
        ],
        transformCtx: (rawCtx) => {
            const ctx = mockCtx(rawCtx)
            const run = ctx.step.run
            ctx.step.run = jest.fn((id: string, ...rest: unknown[]) =>
                id in failures
                    ? Promise.reject(new Error(failures[id]))
                    : (run as (...args: unknown[]) => unknown)(id, ...rest)
            ) as unknown as typeof ctx.step.run
            return ctx
        },
    })
}

function sentEvents(ctx: unknown) {
    const sendEvent = (ctx as { step: { sendEvent: jest.Mock } }).step.sendEvent
    return sendEvent.mock.calls.map(([stepId, payload]) => ({ stepId, ...(payload as object) }))
}

const transcriptionRequest = {
    stepId: 'request-transcription',
    name: 'transcription/requested',
    id: `transcription-requested:${jobId}`,
    data: { transcriptId, jobId, userId, keyTerms: ['Dechra'] },
}
const waveformRequest = (key: string) => ({
    stepId: 'request-waveform',
    name: 'waveform/requested',
    id: `waveform:${transcriptId}:${key}`,
    data: { transcriptId, userId, sourceObjectKey: key },
})

describe('handleMediaPrepare', () => {
    let warn: jest.SpyInstance
    let error: jest.SpyInstance

    beforeEach(() => {
        jest.clearAllMocks()
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        error = jest.spyOn(console, 'error').mockImplementation(() => {})
        jest.spyOn(console, 'log').mockImplementation(() => {})
        steps.loadSource.mockResolvedValue({ proceed: true, sourceKey, skip: null })
        steps.decide.mockResolvedValue(transcode)
        steps.convertAndUpload.mockResolvedValue({ outcome: 'uploaded' })
        steps.linkPrepared.mockResolvedValue({ outcome: 'linked' })
        steps.removeOriginal.mockResolvedValue('removed')
        steps.settleUnlinked.mockResolvedValue('original')
        steps.claimWaveform.mockImplementation(async () => ({ dispatch: true, sourceObjectKey: preparedKey }))
        jobQueuedMock.mockResolvedValue(true)
    })

    afterEach(() => jest.restoreAllMocks())

    test('is keyed by job for idempotency and serialised per transcript', () => {
        expect(handleMediaPrepare.opts.idempotency).toBe('event.data.jobId')
        expect(handleMediaPrepare.opts.concurrency).toEqual([
            { limit: 1, key: 'event.data.transcriptId' },
            { limit: 2 },
        ])
    })

    test('a file to keep goes straight to transcription and the waveform, with event ids', async () => {
        steps.decide.mockResolvedValue(keep)
        steps.claimWaveform.mockResolvedValue({ dispatch: true, sourceObjectKey: sourceKey })

        const { result, ctx } = await execute()

        expect(result).toMatchObject({ status: 'requested', media: 'kept' })
        expect(steps.convertAndUpload).not.toHaveBeenCalled()
        expect(sentEvents(ctx)).toEqual([transcriptionRequest, waveformRequest(sourceKey)])
    })

    test('a file to repack is converted, swapped and its original removed, in that order', async () => {
        const order: string[] = []
        steps.convertAndUpload.mockImplementation(async () => { order.push('convert'); return { outcome: 'uploaded' } })
        steps.linkPrepared.mockImplementation(async () => { order.push('link'); return { outcome: 'linked' } })
        steps.removeOriginal.mockImplementation(async () => { order.push('remove'); return 'removed' })

        const { result, ctx } = await execute()

        expect(order).toEqual(['convert', 'link', 'remove'])
        expect(steps.convertAndUpload.mock.calls[0][1]).toMatchObject({ sourceKey, preparedKey })
        expect(result).toMatchObject({ status: 'requested', media: 'prepared' })
        expect(sentEvents(ctx)).toEqual([transcriptionRequest, waveformRequest(preparedKey)])
        expect(steps.settleUnlinked).not.toHaveBeenCalled()
    })

    test('a failed original delete after the swap is tried once more, then goes on with the prepared file', async () => {
        steps.settleUnlinked.mockResolvedValue('prepared')

        const { result, ctx } = await execute([], { 'remove-original': 'storage down' })

        expect(steps.removeOriginal).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({ status: 'requested', media: 'prepared' })
        expect(error.mock.calls.some(([message]) => String(message).includes('Original cleanup failed'))).toBe(false)
        expect(warn.mock.calls.some(([message]) => String(message).includes('using original'))).toBe(false)
        expect(sentEvents(ctx)).toEqual([transcriptionRequest, waveformRequest(preparedKey)])
    })

    test('an original that still cannot be deleted is logged and the run goes on', async () => {
        steps.settleUnlinked.mockResolvedValue('prepared')

        const { result, ctx } = await execute([], {
            'remove-original': 'storage down',
            'remove-original-after-failure': 'storage still down',
        })

        expect(result).toMatchObject({ status: 'requested', media: 'prepared' })
        expect(error.mock.calls.some(([message]) => String(message).includes('Original cleanup failed'))).toBe(true)
        expect(warn.mock.calls.some(([message]) => String(message).includes('using original'))).toBe(false)
        expect(sentEvents(ctx)).toEqual([transcriptionRequest, waveformRequest(preparedKey)])
    })

    test('a failed conversion falls back to the original and still transcribes', async () => {
        steps.claimWaveform.mockResolvedValue({ dispatch: true, sourceObjectKey: sourceKey })

        const { result, ctx } = await execute([], { 'convert-and-upload': 'upload failed' })

        expect(steps.settleUnlinked).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({ status: 'requested', media: 'fell_back' })
        expect(warn.mock.calls.some(([message]) => String(message).includes('using original'))).toBe(true)
        expect(sentEvents(ctx)).toEqual([transcriptionRequest, waveformRequest(sourceKey)])
    })

    test('an aborted upload is reconciled before falling back', async () => {
        steps.convertAndUpload.mockResolvedValue({ outcome: 'rejected', reason: 'upload_timeout' })

        const { result } = await execute()

        expect(steps.settleUnlinked).toHaveBeenCalledTimes(1)
        expect(steps.linkPrepared).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'requested', media: 'fell_back' })
    })

    test.each(['convert_timeout', 'hit_ceiling', 'not_worth_it', 'waited_too_long'])('a %s rejection still settles against the row, then falls back', async (reason) => {
        // A retry of the step can reject after an earlier attempt uploaded.
        steps.convertAndUpload.mockResolvedValue({ outcome: 'rejected', reason })

        const { result } = await execute()

        expect(steps.settleUnlinked).toHaveBeenCalledTimes(1)
        expect(steps.settleUnlinked.mock.calls[0][1]).toEqual({ transcriptId, sourceKey, preparedKey })
        expect(steps.linkPrepared).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'requested', media: 'fell_back' })
    })

    test('a rejection whose earlier attempt was linked after all goes on with the prepared file', async () => {
        steps.convertAndUpload.mockResolvedValue({ outcome: 'rejected', reason: 'convert_timeout' })
        steps.settleUnlinked.mockResolvedValue('prepared')

        const { result, ctx } = await execute()

        expect(steps.removeOriginal).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({ status: 'requested', media: 'prepared' })
        expect(sentEvents(ctx)).toEqual([transcriptionRequest, waveformRequest(preparedKey)])
    })

    test('when the row cannot be read after a failure, the run fails rather than guessing', async () => {
        const { error: runError, ctx } = await execute([], {
            'convert-and-upload': 'upload failed',
            'reconcile-after-failure': 'read failed',
        })

        expect(String((runError as Error)?.message ?? runError)).toContain('read failed')
        expect(sentEvents(ctx)).toEqual([])
    })

    const supersededFailure = {
        stepId: 'fail-superseded',
        name: 'transcription/failed',
        id: `media-prepare-superseded:${jobId}`,
        data: {
            transcriptId,
            jobId,
            error: "The transcript's media changed while it was being prepared",
            errorType: 'transcription_error',
        },
    }

    test('a transcript deleted mid-run stops quietly: its job went with it', async () => {
        steps.linkPrepared.mockResolvedValue({ outcome: 'gone' })

        const { result, ctx } = await execute()

        expect(result).toEqual({ status: 'stopped', reason: 'transcript_gone' })
        expect(sentEvents(ctx)).toEqual([])
    })

    test('a transcript now holding another file fails the job straight away', async () => {
        steps.linkPrepared.mockResolvedValue({ outcome: 'superseded' })

        const { result, ctx } = await execute()

        expect(result).toEqual({ status: 'stopped', reason: 'superseded' })
        expect(steps.removeOriginal).not.toHaveBeenCalled()
        expect(sentEvents(ctx)).toEqual([supersededFailure])
    })

    test('a reconciliation that finds another file also fails the job', async () => {
        steps.settleUnlinked.mockResolvedValue('superseded')

        const { result, ctx } = await execute([], { 'convert-and-upload': 'upload failed' })

        expect(result).toEqual({ status: 'stopped', reason: 'superseded' })
        expect(sentEvents(ctx)).toEqual([supersededFailure])
    })

    test('a reconciliation that finds the transcript gone stops quietly', async () => {
        steps.settleUnlinked.mockResolvedValue('gone')

        const { result, ctx } = await execute([], { 'convert-and-upload': 'upload failed' })

        expect(result).toEqual({ status: 'stopped', reason: 'transcript_gone' })
        expect(sentEvents(ctx)).toEqual([])
    })

    test('a job that stops being queued before the swap gets no swap and no Deepgram call', async () => {
        steps.linkPrepared.mockResolvedValue({ outcome: 'not_current' })

        const { result, ctx } = await execute()

        expect(result).toEqual({ status: 'stopped', reason: 'job_not_current' })
        expect(steps.removeOriginal).not.toHaveBeenCalled()
        expect(sentEvents(ctx)).toEqual([])
    })

    test('a job no longer queued at dispatch is not sent to Deepgram', async () => {
        jobQueuedMock.mockResolvedValue(false)

        const { result, ctx } = await execute()

        expect(result).toEqual({ status: 'stopped', reason: 'job_not_current' })
        expect(sentEvents(ctx)).toEqual([])
    })

    test('a replay after dispatch, with the job now processing, still requests the waveform', async () => {
        // The whole handler runs again; the earlier steps answer from their
        // memoized results, as Inngest replays them. The job has since moved on.
        jobQueuedMock.mockResolvedValue(false)
        const { result, ctx } = await execute([
            { id: 'load-source', handler: () => ({ proceed: true, sourceKey, skip: null }) },
            { id: 'decide', handler: () => transcode },
            { id: 'convert-and-upload', handler: () => ({ outcome: 'uploaded' }) },
            { id: 'link-prepared', handler: () => ({ outcome: 'linked' }) },
            { id: 'remove-original', handler: () => 'removed' },
            { id: 'authorize-transcription', handler: () => true },
        ])

        expect(jobQueuedMock).not.toHaveBeenCalled()
        expect(steps.convertAndUpload).not.toHaveBeenCalled()
        expect(steps.claimWaveform).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({ status: 'requested', media: 'prepared' })
        expect(sentEvents(ctx)).toContainEqual(waveformRequest(preparedKey))
    })

    test('a replay after the waveform claim was saved still sends the waveform request', async () => {
        const { ctx } = await execute([
            { id: 'claim-waveform', handler: () => ({ dispatch: true, sourceObjectKey: preparedKey }) },
        ])

        expect(steps.claimWaveform).not.toHaveBeenCalled()
        expect(sentEvents(ctx)).toContainEqual(waveformRequest(preparedKey))
    })

    test('a waveform failure never fails the run', async () => {
        const { result, error: runError } = await execute([], { 'claim-waveform': 'waveform read failed' })

        expect(runError).toBeUndefined()
        expect(result).toMatchObject({ status: 'requested' })
    })

    test('a failed decide step keeps the file and still transcribes', async () => {
        steps.claimWaveform.mockResolvedValue({ dispatch: true, sourceObjectKey: sourceKey })

        const { result, ctx } = await execute([], { decide: 'storage down' })

        expect(steps.convertAndUpload).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'requested', media: 'kept' })
        expect(sentEvents(ctx)).toEqual([transcriptionRequest, waveformRequest(sourceKey)])
    })

    test('a failed load-source step fails the run rather than skip the source check', async () => {
        const { error: runError, ctx } = await execute([], { 'load-source': 'database down' })

        expect(String((runError as Error)?.message ?? runError)).toContain('database down')
        expect(steps.decide).not.toHaveBeenCalled()
        expect(sentEvents(ctx)).toEqual([])
    })

    test.each(['waveform_busy', 'waited_too_long'])('a %s source keeps the original and still transcribes', async (skip) => {
        steps.loadSource.mockResolvedValue({ proceed: true, sourceKey, skip })

        const { result, ctx } = await execute()

        expect(steps.decide).not.toHaveBeenCalled()
        expect(steps.convertAndUpload).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'requested', media: 'kept' })
        expect(sentEvents(ctx)[0]).toEqual(transcriptionRequest)
    })

    test('a source that is not this request\'s fails the job and never transcribes', async () => {
        steps.loadSource.mockResolvedValue({ proceed: false, reason: 'invalid_source' })

        const { result, ctx } = await execute()

        expect(result).toEqual({ status: 'stopped', reason: 'invalid_source' })
        expect(steps.decide).not.toHaveBeenCalled()
        expect(sentEvents(ctx)).toEqual([{
            stepId: 'fail-invalid_source',
            name: 'transcription/failed',
            id: `media-prepare-invalid_source:${jobId}`,
            data: { transcriptId, jobId, error: "The transcript's media does not belong to this request", errorType: 'transcription_error' },
        }])
    })

    test('a stopped load never decides or transcribes', async () => {
        steps.loadSource.mockResolvedValue({ proceed: false, reason: 'job_not_current' })

        const { result, ctx } = await execute()

        expect(result).toEqual({ status: 'stopped', reason: 'job_not_current' })
        expect(steps.decide).not.toHaveBeenCalled()
        expect(sentEvents(ctx)).toEqual([])
    })

    describe('transcription options', () => {
        const options = { engine: 'deepgram', language: 'ja', detect_speakers: false, keep_filler_words: true, mask_profanity: true }
        const withOptions = { ...event.data, transcriptionOptions: options }
        const requestWithOptions = { ...transcriptionRequest, data: withOptions }

        test('go on to transcription with a prepared file', async () => {
            const { ctx } = await execute([], {}, withOptions)
            expect(sentEvents(ctx)[0]).toEqual(requestWithOptions)
        })

        test('go on to transcription when preparation is skipped', async () => {
            steps.loadSource.mockResolvedValue({ proceed: true, sourceKey, skip: 'waited_too_long' })
            steps.claimWaveform.mockResolvedValue({ dispatch: true, sourceObjectKey: sourceKey })

            const { ctx } = await execute([], {}, withOptions)

            expect(steps.decide).not.toHaveBeenCalled()
            expect(sentEvents(ctx)[0]).toEqual(requestWithOptions)
        })

        test('go on to transcription when preparation falls back', async () => {
            steps.claimWaveform.mockResolvedValue({ dispatch: true, sourceObjectKey: sourceKey })

            const { result, ctx } = await execute([], { 'convert-and-upload': 'upload failed' }, withOptions)

            expect(result).toMatchObject({ media: 'fell_back' })
            expect(sentEvents(ctx)[0]).toEqual(requestWithOptions)
        })
    })
})
