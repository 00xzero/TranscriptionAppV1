/**
 * Core: Media preparation policy
 *
 * Decides, from one ffprobe of an upload, whether the server keeps it as is,
 * copies its sound out of a video, or repacks oversized sound at a generous
 * speech setting. Pure: no ffmpeg, no storage.
 *
 * The aim is to shrink files that are much bigger than speech needs, not to
 * squeeze every file. Anything already sensibly sized (WhatsApp audio, Voice
 * Memos, our own recordings: Opus, or AAC at RECORDING_AAC_BITS_PER_SECOND) is
 * kept untouched, because repacking lossy audio loses a little each time and
 * saves little.
 */

export const TARGET_KBPS = 64
export const MAX_SAMPLE_RATE = 48_000
export const REPACK_ABOVE_KBPS = 96
export const COPY_AUDIO_MAX_KBPS = 96
export const MIN_REPACK_BYTES = 10 * 1024 * 1024
// What our own AAC recordings (Safari's audio/mp4) ask MediaRecorder for
// (lib/recording/codecs.ts): under the repack line, so they are kept as they are.
export const RECORDING_AAC_BITS_PER_SECOND = 64_000
export const MAX_SIZE_RATIO = 0.75
export const MAX_OUTPUT_BYTES = 200 * 1024 * 1024
// ffmpeg's -fs may overshoot slightly; anything this close to the ceiling may
// have been cut off, so it is rejected.
export const CEILING_MARGIN_BYTES = 1024 * 1024

export const LOSSLESS_CODECS: ReadonlySet<string> = new Set(['flac', 'alac', 'wavpack', 'tta', 'ape', 'truehd', 'mlp'])

export type SourceProbe = {
    audioStreamCount: number
    hasVideo: boolean
    /**
     * Bytes of cover art, counted in the file's size but not sound: 0 without
     * any, null when there is some of unknown size.
     */
    attachedPictureBytes: number | null
    audioCodec: string | null
    /** Bits per second of the first sound track, when ffprobe reports it. */
    audioBitRate: number | null
    channels: number | null
    sampleRate: number | null
    sizeBytes: number
    /** The sound's length, when a header says; otherwise measured as it converts. */
    audioDurationSeconds: number | null
}

export type KeepReason =
    | 'unreadable'
    | 'no_audio'
    | 'multiple_audio_tracks'
    | 'already_small'
    | 'unknown_bitrate'
    | 'not_worth_it'
    | 'over_budget'

/** `predictedBytes` is null when the duration is unknown: the output check then judges the size. */
export type PreparationDecision =
    | { action: 'keep'; reason: KeepReason }
    | { action: 'copy-audio'; predictedBytes: number | null }
    | { action: 'transcode'; predictedBytes: number | null; sampleRate: number }

function isLossless(codec: string): boolean {
    return codec.startsWith('pcm_') || LOSSLESS_CODECS.has(codec)
}

/**
 * The first sound track's bitrate, or, for a sound-only file, the whole file's
 * average less its cover art when ffprobe has none. A video's average counts
 * its picture, so it has none without a track bitrate.
 */
export function effectiveAudioBitRate(probe: SourceProbe): number | null {
    if (probe.audioBitRate && probe.audioBitRate > 0) return probe.audioBitRate
    const duration = probe.audioDurationSeconds
    if (probe.hasVideo || probe.attachedPictureBytes === null || !duration || duration <= 0) return null
    const audioBytes = probe.sizeBytes - probe.attachedPictureBytes
    return audioBytes > 0 ? (audioBytes * 8) / duration : null
}

function guardSize(
    probe: SourceProbe,
    predictedBytes: number | null,
): KeepReason | null {
    // An unknown size (0) can't be shown to shrink.
    if (probe.sizeBytes <= 0) return 'not_worth_it'
    if (predictedBytes === null) return null
    if (predictedBytes > probe.sizeBytes * MAX_SIZE_RATIO) return 'not_worth_it'
    if (predictedBytes >= MAX_OUTPUT_BYTES - CEILING_MARGIN_BYTES) return 'over_budget'
    return null
}

export function decidePreparation(probe: SourceProbe | null): PreparationDecision {
    // Opus is already efficient for speech, and it is what our own Chrome and
    // Firefox recordings are (their WebM has no track bitrate or header
    // duration, and the file average can sit above the repack line):
    // repacking it only loses quality.
    if (
        probe &&
        !probe.hasVideo &&
        probe.audioStreamCount === 1 &&
        probe.audioCodec?.toLowerCase() === 'opus'
    ) {
        return { action: 'keep', reason: 'already_small' }
    }

    if (!probe || !probe.audioCodec) {
        return { action: 'keep', reason: probe && probe.audioStreamCount === 0 ? 'no_audio' : 'unreadable' }
    }
    if (probe.audioStreamCount > 1) return { action: 'keep', reason: 'multiple_audio_tracks' }

    // Without a header duration nothing can be predicted; the output check
    // compares the result with the measured sound instead.
    const duration = probe.audioDurationSeconds && probe.audioDurationSeconds > 0 ? probe.audioDurationSeconds : null
    const codec = probe.audioCodec.toLowerCase()
    const bitRate = effectiveAudioBitRate(probe)

    if (probe.hasVideo) {
        // The video's own sound track is often already a sensible AAC: copy it
        // out untouched. Without a track bitrate (common in MKV and WebM) its
        // size is unknown and may be surround sound at several hundred kbps,
        // so it is repacked to a known size instead.
        if (codec === 'aac' && bitRate !== null && bitRate <= COPY_AUDIO_MAX_KBPS * 1000) {
            const predictedBytes = duration === null ? null : Math.ceil((bitRate * duration) / 8)
            const blocked = guardSize(probe, predictedBytes)
            return blocked ? { action: 'keep', reason: blocked } : { action: 'copy-audio', predictedBytes }
        }
        return transcodeOrKeep(probe, duration)
    }

    if (isLossless(codec)) return transcodeOrKeep(probe, duration)

    // Lossy sound is repacked only when known to be oversized.
    if (bitRate === null) return { action: 'keep', reason: 'unknown_bitrate' }
    if (bitRate > REPACK_ABOVE_KBPS * 1000 && probe.sizeBytes >= MIN_REPACK_BYTES) {
        return transcodeOrKeep(probe, duration)
    }

    return { action: 'keep', reason: 'already_small' }
}

function transcodeOrKeep(probe: SourceProbe, duration: number | null): PreparationDecision {
    const predictedBytes = duration === null ? null : Math.ceil((TARGET_KBPS * 1000 * duration) / 8)
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
