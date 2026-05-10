/**
 * Server-side ffmpeg / ffprobe wrappers for waveform peak generation.
 *
 * - probeMedia: returns total sample count + duration for bucket sizing
 * - spawnPcmStream: spawns ffmpeg, returns ChildProcess; caller pipes stdout
 *
 * Both accept HTTP(S) URLs as input — ffmpeg fetches lazily over the network,
 * preserving end-to-end streaming. Never download the media into a Buffer.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'

export const FFMPEG_PATH = ffmpegInstaller.path
export const FFPROBE_PATH = ffprobeInstaller.path

export const PEAK_SAMPLE_RATE = 8000
const DEFAULT_FFPROBE_TIMEOUT_MS = 15_000
const DEFAULT_FFMPEG_TIMEOUT_MS = 6 * 60 * 60 * 1000

export class ProcessTimeoutError extends Error {
    constructor(command: string, timeoutMs: number) {
        super(`${command} timed out after ${timeoutMs}ms`)
        this.name = 'ProcessTimeoutError'
    }
}

function readPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) return fallback
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

/**
 * The ffmpeg/ffprobe binaries shipped via @ffmpeg-installer / @ffprobe-installer
 * are statically linked and bypass NSS — they cannot resolve /etc/hosts entries
 * like Docker's `host.docker.internal`. Node (via libc) can. Only rewrite that
 * local-dev hostname; production HTTPS storage URLs must keep their original
 * host for TLS/SNI and storage routing.
 */
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

export type ProbeResult = {
    totalSamples: number
    durationSeconds: number
    sampleRate: number
}

export async function probeMedia(url: string): Promise<ProbeResult> {
    const resolved = await resolveUrlHost(url)
    return new Promise((resolve, reject) => {
        const args = [
            '-v', 'error',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            '-select_streams', 'a:0',
            resolved,
        ]
        const proc = spawn(FFPROBE_PATH, args)
        let settled = false
        const timeout = armProcessTimeout(
            proc,
            'ffprobe',
            readPositiveIntEnv('FFPROBE_TIMEOUT_MS', DEFAULT_FFPROBE_TIMEOUT_MS),
            (error) => {
                if (settled) return
                settled = true
                reject(error)
            }
        )

        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

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
            if (code !== 0) {
                reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(0, 500)}`))
                return
            }
            try {
                const parsed = JSON.parse(stdout)
                const stream = parsed.streams?.[0]
                const format = parsed.format
                if (!stream || !format) {
                    reject(new Error('ffprobe returned no audio stream'))
                    return
                }
                const durationSeconds = Number(format.duration ?? stream.duration)
                if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
                    reject(new Error(`ffprobe returned invalid duration: ${format.duration}`))
                    return
                }
                // We always decode to PEAK_SAMPLE_RATE downstream, so totalSamples is
                // computed against that target rate, not the source rate.
                const totalSamples = Math.floor(durationSeconds * PEAK_SAMPLE_RATE)
                resolve({
                    totalSamples,
                    durationSeconds,
                    sampleRate: PEAK_SAMPLE_RATE,
                })
            } catch (err) {
                reject(new Error(`ffprobe output parse failed: ${err instanceof Error ? err.message : String(err)}`))
            }
        })
    })
}

export async function spawnPcmStream(url: string): Promise<ChildProcessWithoutNullStreams> {
    const resolved = await resolveUrlHost(url)
    const args = [
        '-v', 'error',
        '-i', resolved,
        '-vn',
        '-ac', '1',                    // mono
        '-ar', String(PEAK_SAMPLE_RATE), // downsample
        '-f', 's16le',                  // 16-bit signed little-endian
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
