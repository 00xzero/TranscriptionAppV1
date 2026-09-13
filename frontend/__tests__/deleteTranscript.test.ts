/**
 * Unit tests for deleteTranscript's storage cleanup.
 *
 * Exercises the media + waveform artifact removal that runs before the
 * transcript row is deleted. The waveform object only actually gets removed
 * once its RLS DELETE policy exists
 * (20260704000000_allow_waveform_delete.sql) — without it storage.remove()
 * silently no-ops. These tests pin the client-side contract regardless.
 */

let currentClient: unknown

jest.mock('@/infra/supabase/client', () => ({
    createClient: () => currentClient,
}))

// jest.setup.ts globally mocks '@/lib/supabase/queries' with jest.fn() stubs,
// so pull in the real implementation here. Its internal createClient import
// still resolves to the mock registered above.
const { deleteTranscript } = jest.requireActual<typeof import('@/lib/supabase/queries')>(
    '@/lib/supabase/queries'
)
type StorageKeys = {
    source_object_key: string | null
    waveform_object_key: string | null
}

type Transcript = StorageKeys & { user_id: string }

type BuildOpts = {
    transcript?: Transcript | null
    fetchError?: unknown
    mediaRemoveError?: unknown
    waveformRemoveError?: unknown
    waveformRemoveData?: Array<{ name: string }> | null
    deleteError?: unknown
    deletedTranscript?: StorageKeys | null
    mediaInfoError?: unknown
    waveformInfoError?: unknown
}

const DEFAULT_TRANSCRIPT: Transcript = {
    user_id: 'user-1',
    source_object_key: 'user-1/t-1/audio.webm',
    waveform_object_key: 'user-1/t-1/waveform.json',
}

function buildClient(opts: BuildOpts = {}) {
    const {
        transcript = DEFAULT_TRANSCRIPT,
        fetchError = null,
        mediaRemoveError = null,
        waveformRemoveError = null,
        waveformRemoveData,
        deleteError = null,
        deletedTranscript = transcript,
        mediaInfoError = null,
        waveformInfoError = null,
    } = opts

    const maybeSingle = jest.fn().mockResolvedValue({ data: transcript, error: fetchError })
    const selectEq = jest.fn(() => ({ maybeSingle }))
    const select = jest.fn(() => ({ eq: selectEq }))

    const deleteMaybeSingle = jest.fn().mockResolvedValue({
        data: deletedTranscript,
        error: deleteError,
    })
    const deleteSelect = jest.fn(() => ({ maybeSingle: deleteMaybeSingle }))
    const deleteEq = jest.fn(() => ({ select: deleteSelect }))
    const del = jest.fn(() => ({ eq: deleteEq }))

    const from = jest.fn(() => ({ select, delete: del }))

    const removeByBucket: Record<string, jest.Mock> = {
        media: jest.fn().mockImplementation(async (keys: string[]) => ({
            data: mediaRemoveError ? null : keys.map((name) => ({ name })),
            error: mediaRemoveError,
        })),
        waveforms: jest.fn().mockImplementation(async (keys: string[]) => ({
            data: waveformRemoveError
                ? null
                : (waveformRemoveData ?? keys.map((name) => ({ name }))),
            error: waveformRemoveError,
        })),
    }
    const infoByBucket: Record<string, jest.Mock> = {
        media: jest.fn().mockResolvedValue({
            data: mediaInfoError ? null : { name: transcript?.source_object_key },
            error: mediaInfoError,
        }),
        waveforms: jest.fn().mockResolvedValue({
            data: waveformInfoError ? null : { name: transcript?.waveform_object_key },
            error: waveformInfoError,
        }),
    }
    const storageFrom = jest.fn((bucket: string) => ({
        info: infoByBucket[bucket],
        remove: removeByBucket[bucket],
    }))

    const client = { from, storage: { from: storageFrom } }

    return {
        client,
        from,
        del,
        deleteEq,
        deleteSelect,
        deleteMaybeSingle,
        storageFrom,
        infoByBucket,
        removeByBucket,
    }
}

describe('deleteTranscript', () => {
    it('removes the media and waveform objects, then deletes the row', async () => {
        const h = buildClient()
        currentClient = h.client

        await deleteTranscript('t-1')

        expect(h.storageFrom).toHaveBeenCalledWith('media')
        expect(h.storageFrom).toHaveBeenCalledWith('waveforms')
        expect(h.removeByBucket.media).toHaveBeenCalledWith(['user-1/t-1/audio.webm'])
        expect(h.removeByBucket.waveforms).toHaveBeenCalledWith(['user-1/t-1/waveform.json'])
        expect(h.deleteEq).toHaveBeenCalledWith('id', 't-1')
    })

    it('skips the waveform bucket when waveform_object_key is null', async () => {
        const h = buildClient({
            transcript: {
                user_id: 'user-1',
                source_object_key: 'user-1/t-1/audio.webm',
                waveform_object_key: null,
            },
        })
        currentClient = h.client

        await deleteTranscript('t-1')

        expect(h.storageFrom).toHaveBeenCalledWith('media')
        expect(h.storageFrom).not.toHaveBeenCalledWith('waveforms')
        expect(h.deleteEq).toHaveBeenCalledWith('id', 't-1')
    })

    it('swallows a missing-object error on the waveform and still deletes the row', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const h = buildClient({
            waveformInfoError: { message: 'Object not found', error: 'NoSuchKey' },
        })
        currentClient = h.client

        await expect(deleteTranscript('t-1')).resolves.toEqual({ cleanupPendingKeys: [] })
        expect(h.deleteEq).toHaveBeenCalledWith('id', 't-1')
        expect(warn).toHaveBeenCalled()

        warn.mockRestore()
    })

    it('propagates an unexpected waveform storage error and does not delete the row', async () => {
        const h = buildClient({ waveformRemoveError: { message: 'permission denied' } })
        currentClient = h.client

        await expect(deleteTranscript('t-1')).rejects.toEqual({ message: 'permission denied' })
        expect(h.del).not.toHaveBeenCalled()
    })

    it('does not delete the row when storage reports a no-op and the object remains', async () => {
        const h = buildClient({ waveformRemoveData: [] })
        currentClient = h.client

        await expect(deleteTranscript('t-1')).rejects.toThrow('Storage did not remove object')
        expect(h.del).not.toHaveBeenCalled()
        expect(h.infoByBucket.waveforms).toHaveBeenCalledTimes(2)
    })

    it('propagates a row deletion error after the initial storage cleanup', async () => {
        const h = buildClient({ deleteError: { message: 'row delete denied' } })
        currentClient = h.client

        await expect(deleteTranscript('t-1')).rejects.toEqual({ message: 'row delete denied' })
        expect(h.deleteMaybeSingle).toHaveBeenCalled()
    })

    it('returns early without touching storage when the transcript does not exist', async () => {
        const h = buildClient({ transcript: null })
        currentClient = h.client

        await deleteTranscript('missing')

        expect(h.storageFrom).not.toHaveBeenCalled()
        expect(h.del).not.toHaveBeenCalled()
    })

    it('sweeps a key linked between the initial read and row deletion', async () => {
        const h = buildClient({
            transcript: {
                user_id: 'user-1',
                source_object_key: 'media-old',
                waveform_object_key: null,
            },
            deletedTranscript: { source_object_key: 'media-old', waveform_object_key: 'waveform-late' },
        })
        currentClient = h.client

        await deleteTranscript('t-1')

        expect(h.removeByBucket.waveforms).toHaveBeenCalledWith(['waveform-late'])
    })

    it('reports cleanup pending when a post-delete sweep fails', async () => {
        const h = buildClient({
            transcript: {
                user_id: 'user-1',
                source_object_key: 'media-old',
                waveform_object_key: null,
            },
            deletedTranscript: { source_object_key: 'media-old', waveform_object_key: 'waveform-late' },
            waveformRemoveError: { message: 'bucket unavailable' },
        })
        currentClient = h.client

        await expect(deleteTranscript('t-1')).resolves.toEqual({
            cleanupPendingKeys: ['waveform-late'],
        })
    })

    it('treats a row already deleted by another caller as success', async () => {
        const h = buildClient({ deletedTranscript: null })
        currentClient = h.client

        await expect(deleteTranscript('t-1')).resolves.toEqual({ cleanupPendingKeys: [] })
    })
})
