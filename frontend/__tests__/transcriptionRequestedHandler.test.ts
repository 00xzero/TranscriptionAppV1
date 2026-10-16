/** @jest-environment node */

import { InngestTestEngine } from '@inngest/test'

const jobQueuedMock = jest.fn()
const transcriptMaybeSingleMock = jest.fn()
const getMediaUrlForDeepgramMock = jest.fn()
const startAsyncTranscriptionMock = jest.fn()
const transitionJobMock = jest.fn()

jest.mock('@/lib/inngest/job-checks', () => ({
    jobQueued: (...a: unknown[]) => jobQueuedMock(...a),
}))
jest.mock('@/infra/supabase/admin', () => ({
    createAdminClient: () => ({
        from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: transcriptMaybeSingleMock }) }),
        }),
    }),
}))
jest.mock('@/infra/supabase/storage', () => ({
    getMediaUrlForDeepgram: (...a: unknown[]) => getMediaUrlForDeepgramMock(...a),
}))
jest.mock('@/infra/deepgram', () => ({
    startAsyncTranscription: (...a: unknown[]) => startAsyncTranscriptionMock(...a),
    getCallbackUrl: () => 'https://app.test/api/webhooks/deepgram',
    classifyError: () => ({ type: 'transcription_error', message: 'failed' }),
}))
jest.mock('@/core/transcription/transition', () => ({
    transitionJob: (...a: unknown[]) => transitionJobMock(...a),
}))

import { handleTranscriptionRequested } from '@/lib/inngest/functions/handle-transcription-requested'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const preparedKey = `${userId}/${transcriptId}/${jobId}.m4a`

function execute() {
    const engine = new InngestTestEngine({ function: handleTranscriptionRequested })
    return engine.execute({
        events: [{ name: 'transcription/requested', data: { transcriptId, jobId, userId, keyTerms: ['Dechra'] } }],
    })
}

describe('handleTranscriptionRequested', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jobQueuedMock.mockResolvedValue(true)
        transcriptMaybeSingleMock.mockResolvedValue({ data: { user_id: userId, source_object_key: preparedKey, waveform_status: 'ready' }, error: null })
        getMediaUrlForDeepgramMock.mockResolvedValue({ url: 'https://storage.test/prepared', error: null })
        startAsyncTranscriptionMock.mockResolvedValue({ requestId: 'dg-1' })
        transitionJobMock.mockResolvedValue({ outcome: 'updated' })
    })

    afterEach(() => jest.restoreAllMocks())

    test("signs the row's current key, which preparation may have replaced", async () => {
        const { result } = await execute()

        expect(getMediaUrlForDeepgramMock).toHaveBeenCalledWith(expect.anything(), preparedKey)
        expect(startAsyncTranscriptionMock).toHaveBeenCalledWith(expect.objectContaining({
            mediaUrl: 'https://storage.test/prepared',
            transcriptId,
            keyTerms: ['Dechra'],
        }))
        expect(result).toMatchObject({ status: 'processing', requestId: 'dg-1' })
    })

    test.each([
        ["another user's row", { user_id: '44444444-4444-4444-8444-444444444444', source_object_key: preparedKey }],
        ["a key outside the transcript's folder", { user_id: userId, source_object_key: `${userId}/other/${jobId}.m4a` }],
        ['no media', { user_id: userId, source_object_key: null }],
    ])('does not send %s to Deepgram', async (_name, row) => {
        jest.spyOn(console, 'error').mockImplementation(() => {})
        transcriptMaybeSingleMock.mockResolvedValue({ data: { ...row, waveform_status: 'ready' }, error: null })

        const { error } = await execute()

        expect(getMediaUrlForDeepgramMock).not.toHaveBeenCalled()
        expect(startAsyncTranscriptionMock).not.toHaveBeenCalled()
        expect(error).toBeDefined()
    })

    test('does not call Deepgram for a job that is no longer queued', async () => {
        jobQueuedMock.mockResolvedValue(false)

        const { result } = await execute()

        expect(startAsyncTranscriptionMock).not.toHaveBeenCalled()
        expect(transitionJobMock).not.toHaveBeenCalled()
        expect(result).toEqual({ status: 'skipped', transcriptId, jobId })
    })
})
