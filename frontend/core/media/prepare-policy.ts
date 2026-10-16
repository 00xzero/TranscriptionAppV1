/**
 * Core: Media preparation policy
 *
 * Decides, from one ffprobe of an upload, whether the server keeps it as is,
 * copies its sound out of a video, or repacks oversized sound at a generous
 * speech setting. Pure: no ffmpeg, no storage.
 *
 * The aim is to shrink files that are much bigger than speech needs, not to
 * squeeze every file. Anything already sensibly sized (WhatsApp audio, Voice
 * Memos, our own recordings) is kept untouched, because repacking lossy audio
 * loses a little each time and saves little.
 */

export const TARGET_KBPS = 64
export const MAX_SAMPLE_RATE = 48_000
export const REPACK_ABOVE_KBPS = 96
export const COPY_AUDIO_MAX_KBPS = 96
export const MIN_REPACK_BYTES = 10 * 1024 * 1024
export const MAX_SIZE_RATIO = 0.75
export const MAX_OUTPUT_BYTES = 200 * 1024 * 1024
// ffmpeg's -fs may overshoot slightly; anything this close to the ceiling may
// have been cut off, so it is rejected.
export const CEILING_MARGIN_BYTES = 1024 * 1024

export const LOSSLESS_CODECS: ReadonlySet<string> = new Set(['flac', 'alac', 'wavpack', 'tta', 'ape', 'truehd', 'mlp'])

export type SourceProbe = {
    audioStreamCount: number
    hasVideo: boolean
    audioCodec: string | null
    /** Bits per second of the first sound track, when ffprobe reports it. */
    audioBitRate: number | null
    channels: number | null
    sampleRate: number | null
    sizeBytes: number
    audioDurationSeconds: number | null
}

export type KeepReason =
    | 'unreadable'
    | 'no_audio'
    | 'multiple_audio_tracks'
    | 'already_small'
    | 'not_worth_it'
    | 'over_budget'

export type PreparationDecision =
    | { action: 'keep'; reason: KeepReason }
    | { action: 'copy-audio'; predictedBytes: number }
    | { action: 'transcode'; predictedBytes: number; sampleRate: number }

function isLossless(codec: string): boolean {
    return codec.startsWith('pcm_') || LOSSLESS_CODECS.has(codec)
}

/** The first sound track's bitrate, or the whole file's average when ffprobe has none. */
export function effectiveAudioBitRate(probe: SourceProbe): number | null {
    if (probe.audioBitRate && probe.audioBitRate > 0) return probe.audioBitRate
    if (probe.audioDurationSeconds && probe.audioDurationSeconds > 0 && probe.sizeBytes > 0) {
        return (probe.sizeBytes * 8) / probe.audioDurationSeconds
    }
    return null
}

function guardSize(
    probe: SourceProbe,
    predictedBytes: number,
): KeepReason | null {
    if (predictedBytes > probe.sizeBytes * MAX_SIZE_RATIO) return 'not_worth_it'
    if (predictedBytes >= MAX_OUTPUT_BYTES - CEILING_MARGIN_BYTES) return 'over_budget'
    return null
}

export function decidePreparation(probe: SourceProbe | null): PreparationDecision {
    const duration = probe?.audioDurationSeconds
    if (!probe || !duration || duration <= 0 || !probe.audioCodec) {
        return { action: 'keep', reason: probe && probe.audioStreamCount === 0 ? 'no_audio' : 'unreadable' }
    }
    if (probe.audioStreamCount > 1) return { action: 'keep', reason: 'multiple_audio_tracks' }

    const codec = probe.audioCodec.toLowerCase()
    const bitRate = effectiveAudioBitRate(probe)

    if (probe.hasVideo) {
        // The video's own sound track is often already a sensible AAC: copy it
        // out untouched. Its size is about bitrate × duration.
        if (codec === 'aac' && bitRate !== null && bitRate <= COPY_AUDIO_MAX_KBPS * 1000) {
            const predictedBytes = Math.ceil((bitRate * duration) / 8)
            const blocked = guardSize(probe, predictedBytes)
            return blocked ? { action: 'keep', reason: blocked } : { action: 'copy-audio', predictedBytes }
        }
        return transcodeOrKeep(probe, duration)
    }

    if (isLossless(codec)) return transcodeOrKeep(probe, duration)

    if (
        bitRate !== null &&
        bitRate > REPACK_ABOVE_KBPS * 1000 &&
        probe.sizeBytes >= MIN_REPACK_BYTES
    ) {
        return transcodeOrKeep(probe, duration)
    }

    return { action: 'keep', reason: 'already_small' }
}

function transcodeOrKeep(probe: SourceProbe, duration: number): PreparationDecision {
    const predictedBytes = Math.ceil((TARGET_KBPS * 1000 * duration) / 8)
    const blocked = guardSize(probe, predictedBytes)
    if (blocked) return { action: 'keep', reason: blocked }
    const sampleRate = Math.min(probe.sampleRate && probe.sampleRate > 0 ? probe.sampleRate : MAX_SAMPLE_RATE, MAX_SAMPLE_RATE)
    return { action: 'transcode', predictedBytes, sampleRate }
}

export type PreparedOutput = {
    sizeBytes: number
    audioDurationSeconds: number | null
}

export type RejectReason = 'hit_ceiling' | 'duration_mismatch' | 'not_worth_it'

/** Allowed difference in seconds between the source's and the output's sound. */
export function durationTolerance(sourceSeconds: number): number {
    return 0.5 + sourceSeconds * 0.0005
}

export function acceptPrepared(
    source: SourceProbe,
    output: PreparedOutput,
): { ok: true } | { ok: false; reason: RejectReason } {
    if (output.sizeBytes >= MAX_OUTPUT_BYTES - CEILING_MARGIN_BYTES) return { ok: false, reason: 'hit_ceiling' }
    const sourceSeconds = source.audioDurationSeconds
    if (
        !sourceSeconds ||
        output.audioDurationSeconds === null ||
        Math.abs(output.audioDurationSeconds - sourceSeconds) > durationTolerance(sourceSeconds)
    ) {
        return { ok: false, reason: 'duration_mismatch' }
    }
    if (output.sizeBytes > source.sizeBytes * MAX_SIZE_RATIO) return { ok: false, reason: 'not_worth_it' }
    return { ok: true }
}
