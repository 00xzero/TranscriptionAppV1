/**
 * Stream-aggregate raw 16-bit signed LE PCM into a fixed number of peak-amplitude
 * buckets, normalized to [0, 1]. Memory bounded by `targetPeaks` regardless of
 * input length.
 */

import type { Readable } from 'node:stream'

export const PEAK_COUNT = 2048
const INT16_MAX_ABS = 32768

export type ComputePeaksResult = {
    peaks: Float32Array
    pointsPerSecond: number
}

export async function computePeaks(
    pcmStream: Readable,
    opts: { totalSamples: number; targetPeaks?: number; durationSeconds: number }
): Promise<ComputePeaksResult> {
    const targetPeaks = opts.targetPeaks ?? PEAK_COUNT
    const totalSamples = Math.max(opts.totalSamples, targetPeaks)
    const samplesPerBucket = totalSamples / targetPeaks

    const peaks = new Float32Array(targetPeaks)
    let bucketIndex = 0
    let bucketMaxAbs = 0
    let samplesIntoBucket = 0
    let nextBucketBoundary = samplesPerBucket
    let sampleIndex = 0
    let lastFilledValue = 0
    // Half a 16-bit sample carried across chunk boundaries.
    let leftoverByte: number | null = null

    return new Promise((resolve, reject) => {
        pcmStream.on('error', reject)

        pcmStream.on('data', (chunk: Buffer) => {
            let offset = 0
            if (leftoverByte !== null && chunk.length > 0) {
                const sample = (leftoverByte | (chunk[0] << 8))
                const signed = sample > 32767 ? sample - 65536 : sample
                ingestSample(signed)
                offset = 1
                leftoverByte = null
            }
            const usableEnd = chunk.length - ((chunk.length - offset) % 2)
            for (let i = offset; i < usableEnd; i += 2) {
                const sample = chunk.readInt16LE(i)
                ingestSample(sample)
            }
            if (usableEnd < chunk.length) {
                leftoverByte = chunk[chunk.length - 1]
            }
        })

        pcmStream.on('end', () => {
            if (samplesIntoBucket > 0 && bucketIndex < targetPeaks) {
                const value = bucketMaxAbs / INT16_MAX_ABS
                peaks[bucketIndex] = value
                lastFilledValue = value
                bucketIndex++
            }
            // ffmpeg may emit slightly fewer samples than ffprobe predicted;
            // pad with the last value so the tail isn't visually flat-zero.
            for (let i = bucketIndex; i < targetPeaks; i++) {
                peaks[i] = lastFilledValue
            }
            const pointsPerSecond = opts.durationSeconds > 0
                ? targetPeaks / opts.durationSeconds
                : 0
            resolve({ peaks, pointsPerSecond })
        })
    })

    function ingestSample(sample: number) {
        const abs = sample < 0 ? -sample : sample
        if (abs > bucketMaxAbs) bucketMaxAbs = abs
        sampleIndex++
        samplesIntoBucket++
        if (sampleIndex >= nextBucketBoundary && bucketIndex < targetPeaks) {
            const value = bucketMaxAbs / INT16_MAX_ABS
            peaks[bucketIndex] = value
            lastFilledValue = value
            bucketIndex++
            bucketMaxAbs = 0
            samplesIntoBucket = 0
            nextBucketBoundary = (bucketIndex + 1) * samplesPerBucket
        }
    }
}

/**
 * Wire format for the peaks artifact stored in Supabase Storage.
 */
export type WaveformArtifact = {
    version: 1
    duration_seconds: number
    points_per_second: number
    peaks: number[]
}

export const WAVEFORM_ARTIFACT_VERSION = 1
export const WAVEFORM_BUCKET = 'waveforms'

export function buildWaveformObjectKey(userId: string, transcriptId: string): string {
    return `${userId}/${transcriptId}/waveform.json`
}

export function buildWaveformArtifact(
    peaks: Float32Array,
    durationSeconds: number,
    pointsPerSecond: number
): WaveformArtifact {
    // 4 decimals: ~3× smaller JSON, well under visual perception threshold.
    const rounded: number[] = new Array(peaks.length)
    for (let i = 0; i < peaks.length; i++) {
        rounded[i] = Math.round(peaks[i] * 10000) / 10000
    }
    return {
        version: WAVEFORM_ARTIFACT_VERSION,
        duration_seconds: durationSeconds,
        points_per_second: pointsPerSecond,
        peaks: rounded,
    }
}
