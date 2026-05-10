/**
 * @jest-environment node
 */
import { Readable } from 'node:stream'
import { computePeaks, buildWaveformArtifact, PEAK_COUNT } from '@/lib/audio/compute-peaks'

function pcmFromInt16(samples: number[]): Buffer {
    const buf = Buffer.alloc(samples.length * 2)
    samples.forEach((s, i) => buf.writeInt16LE(s, i * 2))
    return buf
}

function streamOf(...buffers: Buffer[]): Readable {
    return Readable.from(buffers, { objectMode: false })
}

describe('computePeaks', () => {
    test('produces requested number of buckets with constant amplitude input', async () => {
        const samples = new Array(8192).fill(16384) // half of int16 max
        const stream = streamOf(pcmFromInt16(samples))
        const { peaks, pointsPerSecond } = await computePeaks(stream, {
            totalSamples: samples.length,
            targetPeaks: 32,
            durationSeconds: 1,
        })
        expect(peaks).toHaveLength(32)
        peaks.forEach((p) => {
            expect(p).toBeCloseTo(0.5, 3)
        })
        expect(pointsPerSecond).toBe(32)
    })

    test('captures peak amplitude per bucket, not average', async () => {
        // First half low, second half high — two-bucket aggregation should reflect both
        const samples: number[] = []
        for (let i = 0; i < 1000; i++) samples.push(1000)
        for (let i = 0; i < 1000; i++) samples.push(30000)
        const stream = streamOf(pcmFromInt16(samples))
        const { peaks } = await computePeaks(stream, {
            totalSamples: samples.length,
            targetPeaks: 2,
            durationSeconds: 1,
        })
        expect(peaks[0]).toBeCloseTo(1000 / 32768, 3)
        expect(peaks[1]).toBeCloseTo(30000 / 32768, 3)
    })

    test('treats negative samples as positive amplitude', async () => {
        const samples = new Array(2048).fill(-20000)
        const stream = streamOf(pcmFromInt16(samples))
        const { peaks } = await computePeaks(stream, {
            totalSamples: samples.length,
            targetPeaks: 4,
            durationSeconds: 1,
        })
        peaks.forEach((p) => {
            expect(p).toBeCloseTo(20000 / 32768, 3)
        })
    })

    test('reassembles samples split across chunk boundaries', async () => {
        // Force odd-byte splits between chunks
        const samples = [10000, -10000, 20000, -20000, 5000, -5000]
        const buf = pcmFromInt16(samples)
        const chunkA = buf.subarray(0, 3)  // 1.5 samples
        const chunkB = buf.subarray(3, 7)  // 2 samples (1.5 + 0.5)
        const chunkC = buf.subarray(7)     // remainder
        const stream = streamOf(chunkA, chunkB, chunkC)
        const { peaks } = await computePeaks(stream, {
            totalSamples: samples.length,
            targetPeaks: 1,
            durationSeconds: 1,
        })
        expect(peaks[0]).toBeCloseTo(20000 / 32768, 3)
    })

    test('handles fewer-than-predicted samples by padding tail', async () => {
        const samples = new Array(500).fill(8000)
        const stream = streamOf(pcmFromInt16(samples))
        const { peaks } = await computePeaks(stream, {
            totalSamples: 1000, // ffprobe over-estimated
            targetPeaks: 4,
            durationSeconds: 1,
        })
        expect(peaks[0]).toBeCloseTo(8000 / 32768, 3)
        // Tail buckets should be padded, not zero
        expect(peaks[3]).toBeGreaterThan(0)
    })
})

describe('buildWaveformArtifact', () => {
    test('produces v1 artifact with serializable peaks array', () => {
        const peaks = new Float32Array([0.1, 0.2, 0.3])
        const artifact = buildWaveformArtifact(peaks, 60, 0.05)
        expect(artifact.version).toBe(1)
        expect(artifact.duration_seconds).toBe(60)
        expect(artifact.points_per_second).toBe(0.05)
        expect(artifact.peaks).toEqual([0.1, 0.2, 0.3])
        // Roundtrip through JSON
        const json = JSON.parse(JSON.stringify(artifact))
        expect(json.peaks[1]).toBeCloseTo(0.2, 3)
    })
})

describe('PEAK_COUNT', () => {
    test('is 2048', () => {
        expect(PEAK_COUNT).toBe(2048)
    })
})
