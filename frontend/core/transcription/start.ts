/**
 * Core: Start Transcription
 *
 * Business logic for triggering a transcription job.
 * Receives an authenticated Supabase client and pre-extracted params — no NextRequest.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendInngestEvent } from '@/infra/inngest/client'
import { createAdminClient } from '@/infra/supabase/admin'
import { getMediaUrlForDeepgram } from '@/infra/supabase/storage'
import { checkRateLimit, RATE_LIMITS } from '@/core/limits/rate-limit'
import { forceJobError } from '@/core/transcription/transition'

export type StartTranscriptionResult =
    | { outcome: 'started'; jobId: string }
    | { outcome: 'cached'; jobId: string }
    | { outcome: 'conflict' }
    | { outcome: 'rate_limited'; limit: number; current: number; retryAfterSeconds: number }
    | { outcome: 'invalid'; reason: string; jobId?: string; jobStatus?: string }
    | { outcome: 'error'; reason: string }

export async function startTranscription(opts: {
    supabase: SupabaseClient
    transcriptId: string
    userId: string
    idempotencyKey: string | null
}): Promise<StartTranscriptionResult> {
    const { supabase, transcriptId, userId, idempotencyKey } = opts

    // Rate limiting
    const rateLimitMode =
        process.env.RATE_LIMIT_MODE ||
        (process.env.NODE_ENV === 'production' ? 'off' : 'memory')
    if (rateLimitMode !== 'off') {
        const rateResult = checkRateLimit(
            `transcription:${userId}`,
            RATE_LIMITS.TRANSCRIPTION_START
        )
        if (!rateResult.allowed) {
            return {
                outcome: 'rate_limited',
                limit: rateResult.limit,
                current: rateResult.current,
                retryAfterSeconds: Math.ceil(rateResult.resetInMs / 1000),
            }
        }
    }

    // Fetch transcript (RLS ensures ownership)
    const { data: transcript, error: transcriptError } = await supabase
        .from('transcripts')
        .select('id, source_object_key, status')
        .eq('id', transcriptId)
        .single()

    if (transcriptError || !transcript) {
        return { outcome: 'invalid', reason: 'Transcript not found' }
    }

    if (!transcript.source_object_key) {
        return { outcome: 'invalid', reason: 'No media file uploaded' }
    }

    // Idempotency pre-check
    if (idempotencyKey) {
        const { data: existingJob, error: lookupError } = await supabase
            .from('jobs')
            .select('id, status')
            .eq('transcript_id', transcriptId)
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle()

        if (!lookupError && existingJob) {
            if (['queued', 'processing', 'completed'].includes(existingJob.status)) {
                console.log(`[start] Returning cached job ${existingJob.id} for idempotency key`)
                return { outcome: 'cached', jobId: existingJob.id }
            }
            if (existingJob.status === 'error') {
                return { outcome: 'invalid', reason: 'Previous transcription attempt failed. Please retry with a new idempotency key.', jobId: existingJob.id, jobStatus: existingJob.status }
            }
        }
    }

    // Reject if already in-flight
    if (transcript.status === 'processing' || transcript.status === 'queued') {
        return { outcome: 'conflict' }
    }

    // Fetch key terms
    const { data: keyTerms, error: keyTermsError } = await supabase
        .from('watchlist')
        .select('term')
        .eq('transcript_id', transcriptId)
    if (keyTermsError) {
        console.warn('[startTranscription] Failed to fetch key terms; proceeding without them:', keyTermsError.message)
    }

    // Get media URL for Deepgram (handles proxy/rewrite env logic)
    const mediaUrlResult = await getMediaUrlForDeepgram(supabase, transcript.source_object_key)
    if (mediaUrlResult.error || !mediaUrlResult.url) {
        return { outcome: 'error', reason: mediaUrlResult.error ?? 'Failed to generate media URL' }
    }
    const mediaUrl = mediaUrlResult.url

    // Create job record
    const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
            transcript_id: transcriptId,
            status: 'queued',
            type: 'transcription',
            ...(idempotencyKey && { idempotency_key: idempotencyKey }),
        })
        .select()
        .single()

    if (jobError) {
        // Handle unique index violation (one active transcription per transcript)
        if (jobError.code === '23505' && jobError.message?.includes('idx_jobs_one_active_per_transcript')) {
            const { data: activeJob } = await supabase
                .from('jobs')
                .select('id, status')
                .eq('transcript_id', transcriptId)
                .in('status', ['queued', 'processing'])
                .limit(1)
                .maybeSingle()
            if (activeJob) {
                return { outcome: 'cached', jobId: activeJob.id }
            }
        }

        // Handle idempotency race
        if (idempotencyKey) {
            const { data: existingJob } = await supabase
                .from('jobs')
                .select('id, status')
                .eq('transcript_id', transcriptId)
                .eq('idempotency_key', idempotencyKey)
                .maybeSingle()
            if (existingJob) {
                if (['queued', 'processing', 'completed'].includes(existingJob.status)) {
                    return { outcome: 'cached', jobId: existingJob.id }
                }
                if (existingJob.status === 'error') {
                    return { outcome: 'invalid', reason: 'Previous transcription attempt failed. Please retry with a new idempotency key.', jobId: existingJob.id, jobStatus: existingJob.status }
                }
            }
        }

        console.error('[startTranscription] Failed to create job:', jobError)
        return { outcome: 'error', reason: 'Failed to create job' }
    }

    // Transcript status is derived by the DB trigger from job INSERT.

    try {
        await sendInngestEvent({
            name: 'transcription/requested',
            data: {
                transcriptId,
                jobId: job.id,
                userId,
                mediaUrl,
                keyTerms: keyTerms?.map((k) => k.term) || [],
            },
        })
    } catch (sendError) {
        console.error('[startTranscription] Failed to send Inngest event:', sendError)
        const errorMessage = sendError instanceof Error ? sendError.message : String(sendError)
        await forceJobError({
            supabase,
            jobId: job.id,
            extraJobFields: {
                payload: {
                    error: 'Failed to start transcription. Please try again.',
                    error_type: 'transcription_error',
                    raw_error: errorMessage.slice(0, 500),
                },
            },
            context: 'startTranscription/inngestSendFailed',
        })
        return { outcome: 'error', reason: 'Failed to start transcription' }
    }

    console.log(`[startTranscription] Started for transcript: ${transcriptId}, job: ${job.id}`)

    // Waveform dispatch is a UI enhancement and MUST NOT fail the transcription
    // start path. Admin client because waveform_status is server-owned (a BEFORE
    // UPDATE trigger rejects writes from the authenticated role).
    let adminSupabase: ReturnType<typeof createAdminClient> | null = null
    try {
        adminSupabase = createAdminClient()
        const { data: waveformClaim, error: waveformStatusError } = await adminSupabase
            .from('transcripts')
            .update({ waveform_status: 'pending' })
            .eq('id', transcriptId)
            .eq('waveform_status', 'skipped')
            .select('id')
            .maybeSingle()
        if (waveformStatusError) {
            console.warn('[startTranscription] Failed to mark waveform pending:', waveformStatusError.message)
            return { outcome: 'started', jobId: job.id }
        }
        if (!waveformClaim) {
            console.warn(`[startTranscription] Skipping waveform/requested for ${transcriptId}; waveform status was not claimable`)
            return { outcome: 'started', jobId: job.id }
        }
        await sendInngestEvent({
            name: 'waveform/requested',
            data: {
                transcriptId,
                userId,
                sourceObjectKey: transcript.source_object_key,
            },
        })
    } catch (waveformError) {
        console.error('[startTranscription] Failed to dispatch waveform/requested (non-fatal):', waveformError)
        if (adminSupabase) {
            try {
                await adminSupabase
                    .from('transcripts')
                    .update({ waveform_status: 'skipped' })
                    .eq('id', transcriptId)
                    .eq('waveform_status', 'pending')
            } catch (rollbackError) {
                console.warn('[startTranscription] Failed to roll back waveform pending status:', rollbackError)
            }
        }
    }

    return { outcome: 'started', jobId: job.id }
}
