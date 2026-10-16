/** @jest-environment node */

import { EventEmitter } from 'node:events'

// A fake ffprobe: answers a header probe with `probeJson`, a picture probe
// with `pictureJson` and a packet scan with `packetCsv`, as the real one
// prints them.
let probeJson: unknown = {}
let pictureJson: unknown = {}
let packetCsv = ''
const spawnMock = jest.fn((_path: string, args: string[]) => {
    const proc = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        killed: false,
        exitCode: null as number | null,
        kill: jest.fn(),
    })
    const output = args.includes('-show_packets')
        ? packetCsv
        : JSON.stringify(args.includes('-read_intervals') ? pictureJson : probeJson)
    setImmediate(() => {
        proc.stdout.emit('data', Buffer.from(output))
        proc.exitCode = 0
        proc.emit('close', 0)
    })
    return proc
})

jest.mock('node:child_process', () => ({ spawn: (...args: [string, string[]]) => spawnMock(...args) }))
jest.mock('@ffmpeg-installer/ffmpeg', () => ({ path: 'ffmpeg' }))
jest.mock('@ffprobe-installer/ffprobe', () => ({ path: 'ffprobe' }))

import { probeSourceMedia, scanAudioDuration } from '@/lib/audio/ffmpeg'

// ffprobe prints most numbers as strings.
const aacTrack = {
    codec_type: 'audio',
    codec_name: 'aac',
    bit_rate: '128000',
    channels: 2,
    sample_rate: '44100',
    duration: '1800.500000',
    disposition: { attached_pic: 0 },
}

function callsWith(flag: string): number {
    return spawnMock.mock.calls.filter(([, args]) => args.includes(flag)).length
}

describe('probeSourceMedia', () => {
    beforeEach(() => {
        spawnMock.mockClear()
        packetCsv = ''
        pictureJson = {}
    })

    test('reads the first sound track and the file size from ffprobe\'s strings', async () => {
        probeJson = { streams: [aacTrack], format: { size: '30000000', duration: '1800.6' } }

        expect(await probeSourceMedia('/tmp/call.m4a')).toEqual({
            audioStreamCount: 1,
            hasVideo: false,
            attachedPictureBytes: 0,
            audioCodec: 'aac',
            audioBitRate: 128_000,
            channels: 2,
            sampleRate: 44_100,
            sizeBytes: 30_000_000,
            audioDurationSeconds: 1800.5,
        })
    })

    test('cover art is not video; its size is only read when the track has no bitrate', async () => {
        const cover = { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }
        probeJson = { streams: [aacTrack, cover], format: { size: '38000000' } }

        expect(await probeSourceMedia('/tmp/podcast.m4a')).toMatchObject({ hasVideo: false, attachedPictureBytes: null })
        expect(callsWith('-read_intervals')).toBe(0)

        probeJson = { streams: [{ ...aacTrack, bit_rate: undefined }, cover, cover], format: { size: '38000000' } }
        pictureJson = { packets: [{ size: '24147' }, { size: '9504' }] }

        expect(await probeSourceMedia('/tmp/podcast.mp3')).toMatchObject({ attachedPictureBytes: 33_651 })
        expect(spawnMock.mock.calls.at(-1)![1]).toEqual(expect.arrayContaining(['-select_streams', 'v', '-read_intervals', '%+#2']))
    })

    test('cover art whose size ffprobe does not give is unknown', async () => {
        const cover = { codec_type: 'video', codec_name: 'png', disposition: { attached_pic: 1 } }
        probeJson = { streams: [{ ...aacTrack, bit_rate: undefined }, cover, cover], format: { size: '38000000' } }
        pictureJson = { packets: [{ size: '24147' }] }

        expect(await probeSourceMedia('/tmp/podcast.mp3')).toMatchObject({ attachedPictureBytes: null })
    })

    test('a picture track is video', async () => {
        probeJson = {
            streams: [{ codec_type: 'video', codec_name: 'h264', disposition: { attached_pic: 0 } }, aacTrack],
            format: { size: '400000000' },
        }

        expect(await probeSourceMedia('/tmp/meeting.mp4')).toMatchObject({ hasVideo: true, attachedPictureBytes: 0, audioCodec: 'aac' })
    })

    test("a Matroska track's DURATION tag is its duration, not the container's", async () => {
        // ffprobe's answer for an MKV whose sound ends three seconds before its picture.
        probeJson = {
            streams: [
                { codec_type: 'video', codec_name: 'mpeg4', tags: { DURATION: '00:00:10.023000000' } },
                { ...aacTrack, bit_rate: undefined, duration: undefined, tags: { 'DURATION-eng': '00:00:07.023000000' } },
            ],
            format: { size: '205000', duration: '10.023000' },
        }

        expect((await probeSourceMedia('/tmp/screen.mkv')).audioDurationSeconds).toBeCloseTo(7.023)
    })

    test("a video's container duration is not its sound's: without a track duration it is unknown", async () => {
        probeJson = {
            streams: [{ codec_type: 'video', codec_name: 'vp9' }, { codec_type: 'audio', codec_name: 'opus' }],
            format: { size: '400000000', duration: '3600.5' },
        }

        expect((await probeSourceMedia('/tmp/screen.webm')).audioDurationSeconds).toBeNull()
        expect(callsWith('-show_packets')).toBe(0)
    })

    test("a sound-only file falls back to the container's duration and never scans packets", async () => {
        probeJson = { streams: [{ ...aacTrack, duration: undefined }], format: { size: '30000000', duration: '1800.6' } }
        expect((await probeSourceMedia('/tmp/call.m4a')).audioDurationSeconds).toBeCloseTo(1800.6)

        probeJson = { streams: [{ codec_type: 'audio', codec_name: 'opus', channels: 1, sample_rate: '48000' }], format: { size: '14000000' } }
        expect(await probeSourceMedia('/tmp/recording.webm')).toMatchObject({ audioCodec: 'opus', audioDurationSeconds: null })
        expect(callsWith('-show_packets')).toBe(0)
    })

    test("scanAudioDuration takes the last packet's end", async () => {
        packetCsv = '0.000000,0.021333\n59.978667,0.021333\n'

        await expect(scanAudioDuration('/tmp/recording.webm', { timeoutMs: 1000 })).resolves.toBeCloseTo(60)
    })

    test('scanAudioDuration stops when aborted', async () => {
        const controller = new AbortController()
        controller.abort()

        await expect(scanAudioDuration('/tmp/recording.webm', { timeoutMs: 1000, signal: controller.signal })).rejects.toThrow('aborted')
        expect(callsWith('-show_packets')).toBe(0)
    })

    test('a file with no sound has no track facts, and an unknown size is 0', async () => {
        probeJson = { streams: [{ codec_type: 'video', codec_name: 'h264' }], format: {} }

        expect(await probeSourceMedia('/tmp/silent.mp4')).toEqual({
            audioStreamCount: 0,
            hasVideo: true,
            attachedPictureBytes: 0,
            audioCodec: null,
            audioBitRate: null,
            channels: null,
            sampleRate: null,
            sizeBytes: 0,
            audioDurationSeconds: null,
        })
    })
})
