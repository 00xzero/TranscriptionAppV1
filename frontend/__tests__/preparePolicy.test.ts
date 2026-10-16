/** @jest-environment node */

import {
    acceptPrepared,
    CEILING_MARGIN_BYTES,
    decidePreparation,
    durationTolerance,
    MAX_OUTPUT_BYTES,
    type SourceProbe,
} from '@/core/media/prepare-policy'

const MB = 1024 * 1024

function audio(overrides: Partial<SourceProbe> & { kbps?: number; minutes?: number; mb?: number }): SourceProbe {
    const { kbps = 128, minutes = 30, mb = 30, ...rest } = overrides
    return {
        audioStreamCount: 1,
        hasVideo: false,
        audioCodec: 'aac',
        audioBitRate: kbps * 1000,
        channels: 2,
        sampleRate: 48_000,
        sizeBytes: Math.round(mb * MB),
        audioDurationSeconds: minutes * 60,
        ...rest,
    }
}

describe('decidePreparation on the last ten real uploads', () => {
    // Probed from the hosted media bucket on 2026-10-16.
    const recent: Array<[string, Partial<SourceProbe> & { kbps: number; minutes: number; mb: number }, string]> = [
        ['Risk assessment (AAC stereo 130 kbps)', { kbps: 130, minutes: 61.1, mb: 58.55 }, 'transcode'],
        ['EPB call (AAC mono 50 kbps)', { kbps: 50, minutes: 120.1, mb: 44.25, channels: 1 }, 'keep'],
        ['WK FCC SOW (MP3 mono 45 kbps)', { kbps: 45, minutes: 22.1, mb: 7.07, channels: 1, audioCodec: 'mp3', sampleRate: 16_000 }, 'keep'],
        ['Call with Lisa (AAC stereo 130 kbps, under 10 MB)', { kbps: 130, minutes: 7.1, mb: 6.82 }, 'keep'],
        ['Sep EPB storyline (AAC stereo 130 kbps)', { kbps: 130, minutes: 35.5, mb: 33.97 }, 'transcode'],
        ['Georgina alignment (AAC stereo 130 kbps)', { kbps: 130, minutes: 25.5, mb: 24.46 }, 'transcode'],
        ['Dechra morning 17.09 (MP3 mono 49 kbps)', { kbps: 49, minutes: 35.7, mb: 12.51, channels: 1, audioCodec: 'mp3', sampleRate: 16_000 }, 'keep'],
        ['DMS call (Voice Memos AAC mono 64 kbps)', { kbps: 64, minutes: 76.3, mb: 37.74, channels: 1 }, 'keep'],
        ['Dechra account planning (AAC stereo 130 kbps)', { kbps: 130, minutes: 44.4, mb: 42.49 }, 'transcode'],
        ['Dechra morning 10.09 (MP3 mono 43 kbps)', { kbps: 43, minutes: 20.9, mb: 6.39, channels: 1, audioCodec: 'mp3', sampleRate: 16_000 }, 'keep'],
    ]

    test.each(recent)('%s → %s', (_name, probe, action) => {
        expect(decidePreparation(audio(probe)).action).toBe(action)
    })

    test('repacks four and keeps six', () => {
        const actions = recent.map(([, probe]) => decidePreparation(audio(probe)).action)
        expect(actions.filter((a) => a === 'transcode')).toHaveLength(4)
        expect(actions.filter((a) => a === 'keep')).toHaveLength(6)
    })

    test('keeps the source sample rate, capped at 48 kHz', () => {
        expect(decidePreparation(audio({ kbps: 256, sampleRate: 96_000 }))).toMatchObject({ action: 'transcode', sampleRate: 48_000 })
        expect(decidePreparation(audio({ kbps: 256, sampleRate: 44_100 }))).toMatchObject({ action: 'transcode', sampleRate: 44_100 })
    })
})

describe('decidePreparation rules', () => {
    test('multiple sound tracks are kept, ahead of every other rule', () => {
        expect(decidePreparation(audio({ audioStreamCount: 2, audioCodec: 'pcm_s16le', kbps: 1411 })))
            .toEqual({ action: 'keep', reason: 'multiple_audio_tracks' })
        expect(decidePreparation(audio({ audioStreamCount: 2, hasVideo: true, kbps: 64, mb: 400 })))
            .toEqual({ action: 'keep', reason: 'multiple_audio_tracks' })
    })

    test('WAV and FLAC are repacked', () => {
        expect(decidePreparation(audio({ audioCodec: 'pcm_s16le', kbps: 1411, mb: 300 })).action).toBe('transcode')
        expect(decidePreparation(audio({ audioCodec: 'flac', kbps: 700, mb: 150 })).action).toBe('transcode')
    })

    test('a small lossless file is still repacked when it is worth it', () => {
        expect(decidePreparation(audio({ audioCodec: 'pcm_s16le', kbps: 256, minutes: 1, mb: 1.9 })).action).toBe('transcode')
    })

    test('a video with sensible AAC sound has its sound copied out', () => {
        expect(decidePreparation(audio({ hasVideo: true, kbps: 96, mb: 400 }))).toMatchObject({ action: 'copy-audio' })
    })

    test('a video with other sound has it repacked', () => {
        expect(decidePreparation(audio({ hasVideo: true, audioCodec: 'opus', kbps: 48, mb: 400 }))).toMatchObject({ action: 'transcode' })
        expect(decidePreparation(audio({ hasVideo: true, kbps: 160, mb: 400 }))).toMatchObject({ action: 'transcode' })
    })

    test('a file that cannot be read is kept', () => {
        expect(decidePreparation(null)).toEqual({ action: 'keep', reason: 'unreadable' })
        expect(decidePreparation(audio({ audioDurationSeconds: null }))).toEqual({ action: 'keep', reason: 'unreadable' })
        expect(decidePreparation(audio({ audioStreamCount: 0, audioCodec: null }))).toEqual({ action: 'keep', reason: 'no_audio' })
    })

    test('without a stream bitrate, the file average decides', () => {
        // 60 MB over 30 minutes is about 280 kbps.
        expect(decidePreparation(audio({ audioBitRate: null, mb: 60 })).action).toBe('transcode')
        // 12 MB over 30 minutes is about 56 kbps.
        expect(decidePreparation(audio({ audioBitRate: null, mb: 12 })).action).toBe('keep')
    })

    test('Opus sound, as our own recordings are, is kept even above the repack line', () => {
        // A Chrome recording: no track bitrate, about 128 kbps on average.
        expect(decidePreparation(audio({ audioCodec: 'opus', audioBitRate: null, minutes: 15, mb: 14 })))
            .toEqual({ action: 'keep', reason: 'already_small' })
    })

    test("a video's AAC without a track bitrate is copied, not judged by the video's average", () => {
        expect(decidePreparation(audio({ hasVideo: true, audioBitRate: null, mb: 300 }))).toMatchObject({ action: 'copy-audio' })
    })

    test('a repack predicted above 75% of the original is not worth it', () => {
        // 64 kbps for 60 min is about 27.5 MB; the file is 32 MB.
        expect(decidePreparation(audio({ audioCodec: 'pcm_s16le', kbps: 1411, minutes: 60, mb: 32 })))
            .toEqual({ action: 'keep', reason: 'not_worth_it' })
    })

    test('a repack predicted over the 200 MB budget is kept', () => {
        // 64 kbps for 7.5 h is about 206 MB.
        expect(decidePreparation(audio({ audioCodec: 'pcm_s16le', kbps: 1411, minutes: 450, mb: 480 })))
            .toEqual({ action: 'keep', reason: 'over_budget' })
    })
})

describe('acceptPrepared', () => {
    const source = audio({ kbps: 130, minutes: 60, mb: 57 })
    const sixtyMinutes = 3600

    test('accepts a matching, smaller file', () => {
        expect(acceptPrepared(source, { sizeBytes: 28 * MB, audioDurationSeconds: sixtyMinutes - 0.1 })).toEqual({ ok: true })
    })

    test('duration must match within 0.5 s + 0.05%', () => {
        const tolerance = durationTolerance(sixtyMinutes)
        expect(tolerance).toBeCloseTo(2.3)
        expect(acceptPrepared(source, { sizeBytes: 28 * MB, audioDurationSeconds: sixtyMinutes - tolerance + 0.01 })).toEqual({ ok: true })
        expect(acceptPrepared(source, { sizeBytes: 28 * MB, audioDurationSeconds: sixtyMinutes - tolerance - 0.01 }))
            .toEqual({ ok: false, reason: 'duration_mismatch' })
        expect(acceptPrepared(source, { sizeBytes: 28 * MB, audioDurationSeconds: null }))
            .toEqual({ ok: false, reason: 'duration_mismatch' })
    })

    test('the output must be at most 75% of the original', () => {
        expect(acceptPrepared(source, { sizeBytes: 57 * MB * 0.75, audioDurationSeconds: sixtyMinutes })).toEqual({ ok: true })
        expect(acceptPrepared(source, { sizeBytes: 57 * MB * 0.75 + 1, audioDurationSeconds: sixtyMinutes }))
            .toEqual({ ok: false, reason: 'not_worth_it' })
    })

    test('anything near the ceiling may have been cut off', () => {
        const big = audio({ audioCodec: 'pcm_s16le', kbps: 1411, minutes: 60, mb: 500 })
        const line = MAX_OUTPUT_BYTES - CEILING_MARGIN_BYTES
        expect(acceptPrepared(big, { sizeBytes: line - 1, audioDurationSeconds: sixtyMinutes })).toEqual({ ok: true })
        expect(acceptPrepared(big, { sizeBytes: line, audioDurationSeconds: sixtyMinutes }))
            .toEqual({ ok: false, reason: 'hit_ceiling' })
        expect(acceptPrepared(big, { sizeBytes: MAX_OUTPUT_BYTES + 4096, audioDurationSeconds: sixtyMinutes }))
            .toEqual({ ok: false, reason: 'hit_ceiling' })
    })
})
