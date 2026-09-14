/**
 * Handle waveform/requested — sibling to transcription/requested. Never blocks
 * transcription. Pipeline: probe → stream PCM via ffmpeg → bucket-aggregate
 * peaks → upload JSON artifact → finalize transcript columns.
 */

import { once } from 'node:events'
import { NonRetriableError } from 'inngest'
import { inngest } from '@/infra/inngest/client'
import { createAdminClient } from '@/infra/supabase/admin'
import { getSignedMediaUrl, WAVEFORM_BUCKET } from '@/infra/supabase/storage'
import { waveformRequestedTrigger } from '@/lib/inngest/events'
import { classifyProjectLinkWriteRejection } from '@/lib/supabase/project-errors'
import { probeMedia, spawnPcmStream } from '@/lib/audio/ffmpeg'
import {
    buildWaveformArtifact,
    buildWaveformObjectKey,
    computePeaks,
    PEAK_COUNT,
    WAVEFORM_ARTIFACT_VERSION,
} from '@/lib/audio/compute-peaks'

const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60 // long enough for multi-hour files

type SupabaseError = {
    code?: string
    message?: string
}

function databaseErrorMessage(error: SupabaseError | null): string {
    return error?.message ?? 'the transcript is no longer available'
}

export const handleWaveformRequested = inngest.createFunction(
    {
        id: 'handle-waveform-requested',
        triggers: [{ event: waveformRequestedTrigger }],
        concurrency: {
            limit: 1,
            key: 'event.data.transcriptId',
        },
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

            const { data: finalizedTranscript, error: dbError } = await supabase
                .from('transcripts')
                .update({
                    waveform_object_key: objectKey,
                    waveform_status: 'ready',
                    waveform_points_per_second: peaksResult.pointsPerSecond,
                    waveform_version: WAVEFORM_ARTIFACT_VERSION,
                })
                .eq('id', transcriptId)
                .select('id')
                .single()

            if (dbError || !finalizedTranscript) {
                const compensate = async () => {
                    const { data: readyReference, error: referenceError } = await supabase
                        .from('transcripts')
                        .select('id')
                        .eq('waveform_object_key', objectKey)
                        .eq('waveform_status', 'ready')
                        .limit(1)
                        .maybeSingle()

                    if (referenceError) {
                        console.error(
                            `[inngest] Could not verify waveform references before compensation for ${transcriptId}:`,
                            referenceError
                        )
                        return
                    }
                    if (readyReference) {
                        console.warn(
                            `[inngest] Preserving waveform ${objectKey}; a ready transcript still references it`
                        )
                        return
                    }

                    const { error: removeError } = await supabase.storage
                        .from(WAVEFORM_BUCKET)
                        .remove([objectKey])
                    if (removeError) {
                        console.error(
                            `[inngest] Failed to compensate waveform upload for ${transcriptId}:`,
                            removeError
                        )
                    }
                }
                const isConfirmedRejectedLink =
                    classifyProjectLinkWriteRejection(dbError) !== null ||
                    (!dbError && !finalizedTranscript)

                if (isConfirmedRejectedLink) {
                    await compensate()
                    throw new NonRetriableError(
                        `Failed to finalize waveform row: ${databaseErrorMessage(dbError)}`
                    )
                }

                const { data: reconciledTranscript, error: reconcileError } = await supabase
                    .from('transcripts')
                    .select(
                        'waveform_object_key, waveform_status, waveform_points_per_second, waveform_version'
                    )
                    .eq('id', transcriptId)
                    .maybeSingle()

                if (reconcileError) {
                    throw new Error(
                        `Failed to finalize waveform row: ${databaseErrorMessage(dbError)}; ` +
                        `reconciliation failed: ${reconcileError.message}`
                    )
                }

                const reconciledPointsPerSecond =
                    reconciledTranscript?.waveform_points_per_second
                const pointsPerSecondMatch =
                    typeof reconciledPointsPerSecond === 'number' &&
                    Math.abs(reconciledPointsPerSecond - peaksResult.pointsPerSecond) <=
                        Math.max(1, Math.abs(peaksResult.pointsPerSecond)) * 1e-6
                const finalizationCommitted =
                    reconciledTranscript?.waveform_object_key === objectKey &&
                    reconciledTranscript.waveform_status === 'ready' &&
                    reconciledTranscript.waveform_version === WAVEFORM_ARTIFACT_VERSION &&
                    pointsPerSecondMatch

                if (finalizationCommitted) {
                    console.warn(
                        `[inngest] Waveform link response was ambiguous for ${transcriptId}; ` +
                        'the committed row was recovered by reconciliation'
                    )
                } else {
                    await compensate()
                    throw new Error(
                        `Failed to finalize waveform row: ${databaseErrorMessage(dbError)}`
                    )
                }
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
