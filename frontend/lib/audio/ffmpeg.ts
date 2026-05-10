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

/**
 * The ffmpeg/ffprobe binaries shipped via @ffmpeg-installer / @ffprobe-installer
 * are statically linked and bypass NSS — they cannot resolve /etc/hosts entries
 * like Docker's `host.docker.internal`. Node (via libc) can. Pre-resolve the
 * hostname here and rewrite the URL with the IP literal so ffmpeg never has to
 * resolve. We keep the IP-literal URL as input; HTTP doesn't require the host
 * header to match the URL hostname for non-TLS requests, and the upstream
 * (signed Storage URLs) doesn't validate Host either.
 */
async function resolveUrlHost(url: string): Promise<string> {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return url
    }
    // Skip IP literals
    if (/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) || parsed.hostname.includes(':')) {
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

        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

        proc.on('error', reject)
        proc.on('close', (code) => {
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
    return spawn(FFMPEG_PATH, args)
}
