/**
 * Server-side ffmpeg / ffprobe wrappers for waveform peaks and media preparation.
 *
 * - probeMedia: returns total sample count + duration for bucket sizing
 * - spawnPcmStream: spawns ffmpeg, returns ChildProcess; caller pipes stdout
 * - probeSourceMedia / prepareAudioFile: probe an upload, copy or repack its sound
 *
 * All accept HTTP(S) URLs as input — ffmpeg fetches lazily over the network,
 * preserving end-to-end streaming. Never download the media into a Buffer.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { TARGET_KBPS, type SourceProbe } from '@/core/media/prepare-policy'
import { readPositiveIntEnv } from '@/lib/env'

export const FFMPEG_PATH = ffmpegInstaller.path
export const FFPROBE_PATH = ffprobeInstaller.path

export const PEAK_SAMPLE_RATE = 8000
const DEFAULT_FFPROBE_TIMEOUT_MS = 15_000
// A packet scan reads the whole file; preparation allows it longer than a
// header probe so a large upload without a header duration can still be sized.
const DEFAULT_PACKET_SCAN_TIMEOUT_MS = 120_000
const DEFAULT_FFMPEG_TIMEOUT_MS = 6 * 60 * 60 * 1000

function firstPositiveNumber(...values: unknown[]): number | null {
    for (const value of values) {
        const numeric = Number(value)
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric
        }
    }
    return null
}

export class ProcessTimeoutError extends Error {
    constructor(command: string, timeoutMs: number) {
        super(`${command} timed out after ${timeoutMs}ms`)
        this.name = 'ProcessTimeoutError'
    }
}

function armProcessTimeout(
    proc: ChildProcessWithoutNullStreams,
    command: string,
    timeoutMs: number,
    onTimeout?: (error: ProcessTimeoutError) => void
): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
        const error = new ProcessTimeoutError(command, timeoutMs)
        onTimeout?.(error)
        if (!proc.killed && proc.exitCode === null) {
            proc.kill('SIGKILL')
        }
    }, timeoutMs)
}

// The bundled ffmpeg/ffprobe binaries are statically linked and bypass NSS, so
// they can't resolve Docker's `host.docker.internal`. Pre-resolve via Node DNS
// for that one local-dev hostname only; never touch production URLs (TLS/SNI).
async function resolveUrlHost(url: string): Promise<string> {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return url
    }
    if (parsed.hostname !== 'host.docker.internal' || parsed.protocol !== 'http:') {
        return url
    }
    try {
        const { address } = await lookup(parsed.hostname, { family: 4 })
        parsed.hostname = address
        return parsed.toString()
    } catch (err) {
        console.warn(`[ffmpeg] Pre-resolution failed for ${parsed.hostname}, passing original URL:`, err instanceof Error ? err.message : err)
        return url
    }
}

type ProcessOutcome = { code: number | null; stdout: string; stderr: string }

// ffmpeg can log an error per broken frame of a long file; only the start of
// stderr is ever reported. stdout is ffprobe's JSON, small and parsed whole.
const STDERR_KEEP_CHARS = 64 * 1024

/**
 * Run a process to exit. stdout is collected whole, or, with `onStdout`,
 * handed over chunk by chunk and not kept.
 */
function runToCompletion(
    command: string,
    path: string,
    args: string[],
    timeoutMs: number,
    onStdout?: (chunk: string) => void
): Promise<ProcessOutcome> {
    return new Promise((resolve, reject) => {
        const proc = spawn(path, args)
        let settled = false
        const timeout = armProcessTimeout(proc, command, timeoutMs, (error) => {
            if (settled) return
            settled = true
            reject(error)
        })
        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (chunk) => {
            if (onStdout) onStdout(chunk.toString())
            else stdout += chunk.toString()
        })
        proc.stderr.on('data', (chunk) => {
            if (stderr.length < STDERR_KEEP_CHARS) stderr = (stderr + chunk.toString()).slice(0, STDERR_KEEP_CHARS)
        })
        proc.on('error', (err) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            reject(err)
        })
        proc.on('close', (code) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            resolve({ code, stdout, stderr })
        })
    })
}

type FfprobeJson = { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }

/** Run ffprobe with JSON output on an already resolved input, and parse it. */
async function runFfprobeJson(resolved: string, args: string[], timeoutMs: number): Promise<FfprobeJson> {
    const { code, stdout, stderr } = await runToCompletion(
        'ffprobe',
        FFPROBE_PATH,
        ['-v', 'error', '-print_format', 'json', ...args, resolved],
        timeoutMs
    )
    if (code !== 0) {
        throw new Error(`ffprobe exited with code ${code}: ${stderr.slice(0, 500)}`)
    }
    try {
        return JSON.parse(stdout)
    } catch (err) {
        throw new Error(`ffprobe output parse failed: ${err instanceof Error ? err.message : String(err)}`)
    }
}

export type ProbeResult = {
    totalSamples: number
    durationSeconds: number
    sampleRate: number
}

async function probeDurationFromPackets(
    resolvedUrl: string,
    timeoutMs = readPositiveIntEnv('FFPROBE_TIMEOUT_MS', DEFAULT_FFPROBE_TIMEOUT_MS)
): Promise<number> {
    let buffered = ''
    let lastDurationEnd = 0

    const ingestLine = (line: string) => {
        const [ptsRaw, durationRaw] = line.trim().split(',')
        const pts = Number(ptsRaw)
        const duration = Number(durationRaw)
        if (!Number.isFinite(pts) || !Number.isFinite(duration)) return
        const packetEnd = pts + duration
        if (packetEnd > lastDurationEnd) {
            lastDurationEnd = packetEnd
        }
    }

    const { code, stderr } = await runToCompletion(
        'ffprobe-packets',
        FFPROBE_PATH,
        [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_packets',
            '-show_entries', 'packet=pts_time,duration_time',
            '-of', 'csv=p=0',
            resolvedUrl,
        ],
        timeoutMs,
        (chunk) => {
            buffered += chunk
            const lines = buffered.split('\n')
            buffered = lines.pop() ?? ''
            for (const line of lines) ingestLine(line)
        }
    )
    if (buffered) ingestLine(buffered)
    if (code !== 0) {
        throw new Error(`ffprobe packets exited with code ${code}: ${stderr.slice(0, 500)}`)
    }
    if (!Number.isFinite(lastDurationEnd) || lastDurationEnd <= 0) {
        throw new Error('ffprobe packets returned no usable duration')
    }
    return lastDurationEnd
}

export async function probeMedia(url: string): Promise<ProbeResult> {
    const resolved = await resolveUrlHost(url)
    const parsed = await runFfprobeJson(
        resolved,
        ['-show_format', '-show_streams', '-select_streams', 'a:0'],
        readPositiveIntEnv('FFPROBE_TIMEOUT_MS', DEFAULT_FFPROBE_TIMEOUT_MS)
    )
    const stream = parsed.streams?.[0]
    const format = parsed.format
    if (!stream || !format) {
        throw new Error('ffprobe returned no audio stream')
    }

    // MediaRecorder-produced WebM can omit container duration even though
    // packet timestamps are valid. Fall back to the final audio packet end so
    // waveform generation still works.
    let durationSeconds = firstPositiveNumber(format.duration, stream.duration)
    if (durationSeconds == null) {
        durationSeconds = await probeDurationFromPackets(resolved).catch((packetErr) => {
            throw new Error(
                `ffprobe returned invalid duration: ${format.duration}; packet fallback failed: ${
                    packetErr instanceof Error ? packetErr.message : String(packetErr)
                }`
            )
        })
    }

    return {
        // Computed against the target decode rate, not the source rate.
        totalSamples: Math.floor(durationSeconds * PEAK_SAMPLE_RATE),
        durationSeconds,
        sampleRate: PEAK_SAMPLE_RATE,
    }
}

export async function spawnPcmStream(url: string): Promise<ChildProcessWithoutNullStreams> {
    const resolved = await resolveUrlHost(url)
    const args = [
        '-v', 'error',
        '-i', resolved,
        '-vn',
        '-ac', '1',
        '-ar', String(PEAK_SAMPLE_RATE),
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        'pipe:1',
    ]
    const proc = spawn(FFMPEG_PATH, args)
    const timeout = armProcessTimeout(
        proc,
        'ffmpeg',
        readPositiveIntEnv('FFMPEG_TIMEOUT_MS', DEFAULT_FFMPEG_TIMEOUT_MS)
    )
    proc.once('close', () => clearTimeout(timeout))
    proc.once('error', () => clearTimeout(timeout))
    return proc
}

// ---------------------------------------------------------------------------
// Media preparation: one probe of the upload, and the copy/repack to .m4a.
// ---------------------------------------------------------------------------

/**
 * One ffprobe of every stream in the upload, for the preparation policy.
 * Accepts a URL or a local path. The sound's duration comes from the first
 * sound track, then the container, then its last packet (MediaRecorder WebM
 * often has no header duration), except for sound-only Opus, which the policy
 * keeps without one. The size is ffprobe's own count of the
 * input's bytes; when it can't tell, 0, which the policy treats as "keep".
 */
export async function probeSourceMedia(input: string): Promise<SourceProbe> {
    const resolved = await resolveUrlHost(input)
    const parsed = await runFfprobeJson(
        resolved,
        ['-show_format', '-show_streams'],
        readPositiveIntEnv('FFPROBE_TIMEOUT_MS', DEFAULT_FFPROBE_TIMEOUT_MS)
    )
    const streams = parsed.streams ?? []
    const audio = streams.filter((s) => s.codec_type === 'audio')
    // Cover art in an m4a is a "video" stream with attached_pic set; it is not video.
    const hasVideo = streams.some((s) =>
        s.codec_type === 'video' &&
        !(s.disposition && (s.disposition as Record<string, unknown>).attached_pic === 1)
    )
    const first = audio[0]
    let audioDurationSeconds = first
        ? firstPositiveNumber(first.duration, parsed.format?.duration)
        : null
    // The policy keeps sound-only Opus whatever its length (our own
    // recordings), so a packet scan of the whole file would be wasted.
    const soundOnlyOpus = !hasVideo && audio.length === 1 && first?.codec_name === 'opus'
    if (first && audioDurationSeconds == null && !soundOnlyOpus) {
        audioDurationSeconds = await probeDurationFromPackets(
            resolved,
            readPositiveIntEnv('FFPROBE_PACKET_SCAN_TIMEOUT_MS', DEFAULT_PACKET_SCAN_TIMEOUT_MS)
        ).catch(() => null)
    }
    return {
        audioStreamCount: audio.length,
        hasVideo,
        audioCodec: typeof first?.codec_name === 'string' ? first.codec_name : null,
        audioBitRate: first ? firstPositiveNumber(first.bit_rate) : null,
        channels: first ? firstPositiveNumber(first.channels) : null,
        sampleRate: first ? firstPositiveNumber(first.sample_rate) : null,
        sizeBytes: firstPositiveNumber(parsed.format?.size) ?? 0,
        audioDurationSeconds,
    }
}

export type PrepareMode =
    | { kind: 'copy-audio' }
    | { kind: 'transcode'; sampleRate: number }

/**
 * Write the upload's first sound track to `outPath` as .m4a: copied untouched,
 * or repacked to mono AAC at TARGET_KBPS. `-fs` stops ffmpeg near `maxBytes`
 * (it may overshoot slightly; the caller checks the real size). Killed after
 * `timeoutMs`, rejecting with ProcessTimeoutError.
 */
export async function prepareAudioFile(
    input: string,
    outPath: string,
    mode: PrepareMode,
    opts: { timeoutMs: number; maxBytes: number }
): Promise<void> {
    const resolved = await resolveUrlHost(input)
    const codecArgs = mode.kind === 'copy-audio'
        ? ['-c:a', 'copy']
        : ['-ac', '1', '-ar', String(mode.sampleRate), '-c:a', 'aac', '-b:a', `${TARGET_KBPS}k`]
    const args = [
        '-v', 'error',
        '-nostdin',
        '-y',
        '-i', resolved,
        '-map', '0:a:0',
        '-vn', '-sn', '-dn',
        ...codecArgs,
        '-fs', String(opts.maxBytes),
        '-movflags', '+faststart',
        '-f', 'mp4',
        outPath,
    ]
    const { code, stderr } = await runToCompletion('ffmpeg-prepare', FFMPEG_PATH, args, opts.timeoutMs)
    if (code !== 0) {
        throw new Error(`ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`)
    }
}
