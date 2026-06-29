/**
 * Handle waveform/requested — sibling to transcription/requested. Never blocks
 * transcription. Pipeline: probe → stream PCM via ffmpeg → bucket-aggregate
 * peaks → upload JSON artifact → finalize transcript columns.
 */

import { once } from 'node:events'
import { inngest } from '@/infra/inngest/client'
import { createAdminClient } from '@/infra/supabase/admin'
import { getSignedMediaUrl } from '@/infra/supabase/storage'
import { waveformRequestedTrigger } from '@/lib/inngest/events'
import { probeMedia, spawnPcmStream } from '@/lib/audio/ffmpeg'
import {
    buildWaveformArtifact,
    buildWaveformObjectKey,
    computePeaks,
    PEAK_COUNT,
    WAVEFORM_ARTIFACT_VERSION,
    WAVEFORM_BUCKET,
} from '@/lib/audio/compute-peaks'

const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60 // long enough for multi-hour files

export const handleWaveformRequested = inngest.createFunction(
    {
        id: 'handle-waveform-requested',
        triggers: [{ event: waveformRequestedTrigger }],
        retries: 3,
        onFailure: async ({ event }) => {
            const { transcriptId } = event.data.event.data
            try {
                const supabase = createAdminClient()
                await supabase
                    .from('transcripts')
                    .update({ waveform_status: 'error' })
                    .eq('id', transcriptId)
                    .in('waveform_status', ['pending', 'processing'])
            } catch (err) {
                console.error(`[inngest] handle-waveform onFailure DB update failed for ${transcriptId}:`, err)
            }
        },
    },
    async ({ event, step }) => {
        const { transcriptId, userId, sourceObjectKey } = event.data
        console.log(`[inngest] Waveform requested for transcript: ${transcriptId}`)

        // Validate event payload against the row of record (don't trust the event
        // bus to sign URLs with admin privileges) and transition to 'processing'.
        const validation = await step.run('mark-processing', async () => {
            const supabase = createAdminClient()
            const { data: transcript, error } = await supabase
                .from('transcripts')
                .select('user_id, source_object_key, waveform_status, waveform_version')
                .eq('id', transcriptId)
                .single()

            if (error || !transcript) {
                throw new Error(`Transcript ${transcriptId} not found: ${error?.message ?? 'no row'}`)
            }

            if (transcript.user_id !== userId) {
                throw new Error(`Transcript ${transcriptId} user_id mismatch: event=${userId}, row=${transcript.user_id}`)
            }
            if (transcript.source_object_key !== sourceObjectKey) {
                throw new Error(`Transcript ${transcriptId} source_object_key mismatch with event payload`)
            }
            const expectedPrefix = `${transcript.user_id}/${transcriptId}/`
            if (!transcript.source_object_key || !transcript.source_object_key.startsWith(expectedPrefix)) {
                throw new Error(`Transcript ${transcriptId} source_object_key does not match expected path shape`)
            }

            if (
                transcript.waveform_status === 'ready' &&
                transcript.waveform_version === WAVEFORM_ARTIFACT_VERSION
            ) {
                console.log(`[inngest] Waveform already ready for ${transcriptId}, skipping`)
                return { shouldGenerate: false as const }
            }

            const { data: claimedTranscript, error: updateError } = await supabase
                .from('transcripts')
                .update({ waveform_status: 'processing' })
                .eq('id', transcriptId)
                // Include processing so retries of this event can re-run the
                // generation step after transient ffmpeg/storage failures.
                .in('waveform_status', ['pending', 'processing', 'skipped'])
                .select('id')
                .maybeSingle()

            if (updateError) {
                throw new Error(`Failed to mark waveform processing: ${updateError.message}`)
            }
            if (!claimedTranscript) {
                console.log(`[inngest] Waveform status no longer claimable for ${transcriptId}, skipping`)
                return { shouldGenerate: false as const }
            }
            return {
                shouldGenerate: true as const,
                verifiedSourceObjectKey: transcript.source_object_key,
            }
        })

        if (!validation.shouldGenerate) {
            return { status: 'skipped', transcriptId }
        }
        const verifiedSourceObjectKey = validation.verifiedSourceObjectKey

        // Single step: peak generation + upload + DB finalize. Retries replay
        // the whole pipeline (Storage upload uses upsert).
        const result = await step.run('generate-peaks', async () => {
            const supabase = createAdminClient()

            const signedUrl = await getSignedMediaUrl(supabase, verifiedSourceObjectKey, SIGNED_URL_TTL_SECONDS)
            if (signedUrl.error || !signedUrl.url) {
                throw new Error(`Failed to sign media URL: ${signedUrl.error ?? 'unknown'}`)
            }

            const probe = await probeMedia(signedUrl.url)
            console.log(`[inngest] Probed ${transcriptId}: ${probe.durationSeconds.toFixed(1)}s, ~${probe.totalSamples} samples`)

            const ffmpeg = await spawnPcmStream(signedUrl.url)
            const stderrChunks: string[] = []
            ffmpeg.stderr.on('data', (chunk) => { stderrChunks.push(chunk.toString()) })

            let peaksResult
            try {
                peaksResult = await computePeaks(ffmpeg.stdout, {
                    totalSamples: probe.totalSamples,
                    targetPeaks: PEAK_COUNT,
                    durationSeconds: probe.durationSeconds,
                })
                if (ffmpeg.exitCode === null) {
                    await once(ffmpeg, 'close')
                }
                if (ffmpeg.exitCode !== 0) {
                    throw new Error(`ffmpeg exited with code ${ffmpeg.exitCode}: ${stderrChunks.join('').slice(0, 500)}`)
                }
            } finally {
                if (!ffmpeg.killed && ffmpeg.exitCode === null) {
                    ffmpeg.kill('SIGKILL')
                }
            }

            const artifact = buildWaveformArtifact(
                peaksResult.peaks,
                probe.durationSeconds,
                peaksResult.pointsPerSecond
            )
            const objectKey = buildWaveformObjectKey(userId, transcriptId)
            const body = JSON.stringify(artifact)

            const { error: uploadError } = await supabase.storage
                .from(WAVEFORM_BUCKET)
                .upload(objectKey, body, {
                    contentType: 'application/json',
                    upsert: true,
                    cacheControl: '3600',
                })
            if (uploadError) {
                throw new Error(`Failed to upload waveform: ${uploadError.message}`)
            }

            const { error: dbError } = await supabase
                .from('transcripts')
                .update({
                    waveform_object_key: objectKey,
                    waveform_status: 'ready',
                    waveform_points_per_second: peaksResult.pointsPerSecond,
                    waveform_version: WAVEFORM_ARTIFACT_VERSION,
                })
                .eq('id', transcriptId)

            if (dbError) {
                throw new Error(`Failed to finalize waveform row: ${dbError.message}`)
            }

            return {
                objectKey,
                durationSeconds: probe.durationSeconds,
                pointsPerSecond: peaksResult.pointsPerSecond,
                peakCount: peaksResult.peaks.length,
            }
        })

        console.log(`[inngest] Waveform ready for ${transcriptId}: ${result.objectKey}`)
        return { status: 'ready', transcriptId, ...result }
    }
)
