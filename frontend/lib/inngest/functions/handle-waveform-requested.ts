/**
 * Handle waveform/requested
 * Sibling to transcription/requested — runs in parallel, never blocks transcription.
 *
 * Pipeline: probe media → stream PCM via ffmpeg → bucket-aggregate peak amplitude
 * → upload JSON artifact to Storage → update project columns.
 */

import { inngest } from '@/infra/inngest/client'
import { createAdminClient } from '@/infra/supabase/admin'
import { getSignedMediaUrl } from '@/infra/supabase/storage'
import { waveformRequestedTrigger } from '@/lib/inngest/events'
import { probeMedia, spawnPcmStream } from '@/lib/audio/ffmpeg'
import {
    buildWaveformArtifact,
    computePeaks,
    PEAK_COUNT,
    WAVEFORM_ARTIFACT_VERSION,
} from '@/lib/audio/compute-peaks'

const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60 // 6 hours — long enough for ffmpeg to finish on multi-hour files
const WAVEFORM_BUCKET = 'waveforms'

function buildWaveformObjectKey(userId: string, projectId: string): string {
    return `${userId}/${projectId}/waveform.json`
}

export const handleWaveformRequested = inngest.createFunction(
    {
        id: 'handle-waveform-requested',
        triggers: [{ event: waveformRequestedTrigger }],
        retries: 3,
        onFailure: async ({ event }) => {
            const { projectId } = event.data.event.data
            try {
                const supabase = createAdminClient()
                await supabase
                    .from('projects')
                    .update({ waveform_status: 'error' })
                    .eq('id', projectId)
                    .neq('waveform_status', 'ready')
            } catch (err) {
                console.error(`[inngest] handle-waveform onFailure DB update failed for ${projectId}:`, err)
            }
        },
    },
    async ({ event, step }) => {
        const { projectId, userId, sourceObjectKey } = event.data
        console.log(`[inngest] Waveform requested for project: ${projectId}`)

        // Step 1: re-validate the event payload against the DB row + idempotency check + transition to 'processing'.
        // Returns the row-of-record source_object_key so step 2 signs that, not the event payload.
        const validation = await step.run('mark-processing', async () => {
            const supabase = createAdminClient()
            const { data: project, error } = await supabase
                .from('projects')
                .select('user_id, source_object_key, waveform_status, waveform_version')
                .eq('id', projectId)
                .single()

            if (error || !project) {
                throw new Error(`Project ${projectId} not found: ${error?.message ?? 'no row'}`)
            }

            // Defense in depth: don't trust the event payload. Verify against the
            // row of record before we sign anything with admin privileges.
            if (project.user_id !== userId) {
                throw new Error(`Project ${projectId} user_id mismatch: event=${userId}, row=${project.user_id}`)
            }
            if (project.source_object_key !== sourceObjectKey) {
                throw new Error(`Project ${projectId} source_object_key mismatch with event payload`)
            }
            const expectedPrefix = `${project.user_id}/${projectId}/`
            if (!project.source_object_key || !project.source_object_key.startsWith(expectedPrefix)) {
                throw new Error(`Project ${projectId} source_object_key does not match expected path shape`)
            }

            if (
                project.waveform_status === 'ready' &&
                project.waveform_version === WAVEFORM_ARTIFACT_VERSION
            ) {
                console.log(`[inngest] Waveform already ready for ${projectId}, skipping`)
                return { shouldGenerate: false as const }
            }

            const { error: updateError } = await supabase
                .from('projects')
                .update({ waveform_status: 'processing' })
                .eq('id', projectId)

            if (updateError) {
                throw new Error(`Failed to mark waveform processing: ${updateError.message}`)
            }
            return {
                shouldGenerate: true as const,
                verifiedSourceObjectKey: project.source_object_key,
            }
        })

        if (!validation.shouldGenerate) {
            return { status: 'skipped', projectId }
        }
        const verifiedSourceObjectKey = validation.verifiedSourceObjectKey

        // Step 2: full peak generation + upload + DB finalize.
        // Single step so retries replay the whole pipeline (Storage upload uses upsert).
        const result = await step.run('generate-peaks', async () => {
            const supabase = createAdminClient()

            const signedUrl = await getSignedMediaUrl(supabase, verifiedSourceObjectKey, SIGNED_URL_TTL_SECONDS)
            if (signedUrl.error || !signedUrl.url) {
                throw new Error(`Failed to sign media URL: ${signedUrl.error ?? 'unknown'}`)
            }

            const probe = await probeMedia(signedUrl.url)
            console.log(`[inngest] Probed ${projectId}: ${probe.durationSeconds.toFixed(1)}s, ~${probe.totalSamples} samples`)

            const ffmpeg = await spawnPcmStream(signedUrl.url)
            const stderrChunks: string[] = []
            ffmpeg.stderr.on('data', (chunk) => { stderrChunks.push(chunk.toString()) })

            const ffmpegDone = new Promise<void>((resolve, reject) => {
                if (ffmpeg.exitCode !== null) {
                    if (ffmpeg.exitCode !== 0) {
                        reject(new Error(`ffmpeg exited with code ${ffmpeg.exitCode}: ${stderrChunks.join('').slice(0, 500)}`))
                        return
                    }
                    resolve()
                    return
                }
                ffmpeg.once('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`ffmpeg exited with code ${code}: ${stderrChunks.join('').slice(0, 500)}`))
                        return
                    }
                    resolve()
                })
                ffmpeg.once('error', reject)
            })

            let peaksResult
            try {
                peaksResult = await computePeaks(ffmpeg.stdout, {
                    totalSamples: probe.totalSamples,
                    targetPeaks: PEAK_COUNT,
                    durationSeconds: probe.durationSeconds,
                })
                await ffmpegDone
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
            const objectKey = buildWaveformObjectKey(userId, projectId)
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
                .from('projects')
                .update({
                    waveform_object_key: objectKey,
                    waveform_status: 'ready',
                    waveform_points_per_second: peaksResult.pointsPerSecond,
                    waveform_version: WAVEFORM_ARTIFACT_VERSION,
                })
                .eq('id', projectId)

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

        console.log(`[inngest] Waveform ready for ${projectId}: ${result.objectKey}`)
        return { status: 'ready', projectId, ...result }
    }
)
