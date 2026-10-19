/**
 * Core: Record a transcription engine's result
 *
 * Business logic for an engine's callback, once its route has checked it:
 * claim the receipt, store the result as the engine sent it, link it to the
 * job and hand it to Inngest. Receives pre-validated params and an admin
 * Supabase client — no NextRequest, no headers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendInngestEvent } from '@/infra/inngest/client'
import { getTranscriptionResultPath } from '@/infra/supabase/storage'
import {
    removeTranscriptionResult,
    uploadTranscriptionResult,
} from '@/infra/supabase/transcription-results.server'
import { forceJobError } from '@/core/transcription/transition'
import type { TranscriptionEngine } from '@/contracts/transcription-options'
import { randomUUID } from 'crypto'

// 5 min lease — matches Vercel Pro/Enterprise max function duration
const RECEIPT_LEASE_MS = 300 * 1000

export type WebhookHandleResult =
    | { outcome: 'processed' }
    | { outcome: 'duplicate' }
    | { outcome: 'retrying'; retryAfter: number }
    | { outcome: 'error'; reason: string }

/**
 * Fail the job a webhook names: by request id (the job's inngest_event_id),
 * else the transcript's active job, else the transcript itself.
 * Returns what it marked failed, or 'nothing' when it found nothing or its
 * write did not go through, so a caller can ask the engine to retry.
 */
export async function persistWebhookFailure(params: {
    supabase: SupabaseClient
    engine: TranscriptionEngine
    transcriptId?: string | null
    requestId?: string | null
    message: string
    /** Defaults to the message. */
    detail?: string
}): Promise<'job' | 'transcript' | 'nothing'> {
    const { supabase } = params
    let resolvedTranscriptId = params.transcriptId || null
    let resolvedJobId: string | null = null

    if (!resolvedTranscriptId && params.requestId) {
        const { data: jobByRequest } = await supabase
            .from('jobs')
            .select('id, transcript_id')
            .eq('inngest_event_id', params.requestId)
            .maybeSingle()
        if (jobByRequest) {
            resolvedTranscriptId = jobByRequest.transcript_id
            resolvedJobId = jobByRequest.id
        }
    }

    if (resolvedTranscriptId && !resolvedJobId) {
        const { data: fallbackJob } = await supabase
            .from('jobs')
            .select('id')
            .eq('transcript_id', resolvedTranscriptId)
            .in('status', ['queued', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        if (fallbackJob) {
            resolvedJobId = fallbackJob.id
        }
    }

    if (resolvedJobId) {
        const saved = await forceJobError({
            supabase,
            jobId: resolvedJobId,
            extraJobFields: {
                finished_at: new Date().toISOString(),
                error_message: params.message,
                error_type: 'transcription_error',
                error_detail: (params.detail ?? params.message).slice(0, 500),
            },
            context: 'persistWebhookFailure',
        })
        return saved ? 'job' : 'nothing'
    }

    if (resolvedTranscriptId) {
        const { error: insertError } = await supabase
            .from('failed_events')
            .insert({
                event_name: `${params.engine}/webhook_failure`,
                event_data: { transcriptId: resolvedTranscriptId, requestId: params.requestId },
                error_message: params.message,
                transcript_id: resolvedTranscriptId,
            })
        if (insertError) {
            console.error('[webhook] Failed to insert failed_event:', insertError)
        }

        const { error: transcriptError } = await supabase
            .from('transcripts')
            .update({ status: 'error' })
            .eq('id', resolvedTranscriptId)
        if (transcriptError) {
            console.error('[webhook] Failed to update transcript error status:', transcriptError)
            return 'nothing'
        }
        return 'transcript'
    }

    return 'nothing'
}

export async function recordEngineResult(opts: {
    supabase: SupabaseClient
    engine: TranscriptionEngine
    requestId: string
    transcriptId: string
    /** The validated result, exactly as the engine sent it. */
    rawBody: string
}): Promise<WebhookHandleResult & { attemptId?: string }> {
    const { supabase, engine, requestId, transcriptId, rawBody } = opts

    // Claim idempotency receipt
    const myAttemptId = randomUUID()

    const { error: claimError } = await supabase
        .from('webhook_receipts')
        .insert({
            provider: engine,
            request_id: requestId,
            transcript_id: transcriptId,
            attempt_id: myAttemptId,
            claimed_at: new Date().toISOString(),
        })

    let activeAttemptId = myAttemptId

    if (claimError) {
        if (claimError.code === '23505') {
            const { data: existing, error: selectError } = await supabase
                .from('webhook_receipts')
                .select('status, attempt_id, claimed_at')
                .eq('provider', engine)
                .eq('request_id', requestId)
                .single()

            if (selectError || !existing) {
                console.error('[webhook] Failed to read existing receipt:', selectError)
                return { outcome: 'error', reason: 'Receipt state unavailable' }
            }

            if (existing.status === 'completed') {
                console.log(`[webhook] Duplicate (completed) for ${requestId} — no-op`)
                return { outcome: 'duplicate' }
            }

            const isFresh = Date.now() - new Date(existing.claimed_at).getTime() < RECEIPT_LEASE_MS

            if (existing.status === 'processing' && isFresh) {
                console.log(`[webhook] In-flight duplicate for ${requestId} — retrying`)
                return { outcome: 'retrying', retryAfter: 30 }
            }

            // Attempt conditional takeover
            const newAttemptId = randomUUID()
            const { data: takeoverRows, error: takeoverError } = await supabase
                .from('webhook_receipts')
                .update({
                    status: 'processing',
                    attempt_id: newAttemptId,
                    claimed_at: new Date().toISOString(),
                    last_error: null,
                })
                .eq('provider', engine)
                .eq('request_id', requestId)
                .eq('attempt_id', existing.attempt_id)
                .neq('status', 'completed')
                .select('id')

            if (takeoverError) {
                console.error('[webhook] Takeover update failed:', takeoverError)
                return { outcome: 'error', reason: 'Takeover failed' }
            }

            if (!takeoverRows || takeoverRows.length === 0) {
                const { data: reread } = await supabase
                    .from('webhook_receipts')
                    .select('status')
                    .eq('provider', engine)
                    .eq('request_id', requestId)
                    .single()

                if (reread?.status === 'completed') {
                    console.log(`[webhook] Post-takeover read shows completed for ${requestId} — no-op`)
                    return { outcome: 'duplicate' }
                }

                console.log(`[webhook] Lost takeover race for ${requestId} — retrying`)
                return { outcome: 'retrying', retryAfter: 30 }
            }

            activeAttemptId = newAttemptId
            console.log(`[webhook] Takeover successful for ${requestId}`)
        } else {
            console.error('[webhook] Failed to claim receipt (non-conflict):', claimError)
            return { outcome: 'retrying', retryAfter: 30 }
        }
    }

    // Look up the job the response belongs to
    const { data: exactJob, error: exactJobError } = await supabase
        .from('jobs')
        .select('id')
        .eq('transcript_id', transcriptId)
        .eq('inngest_event_id', requestId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (exactJobError) {
        console.error('[webhook] Failed to lookup job by requestId:', exactJobError)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, exactJobError.message)
        throw new Error(`Failed to lookup job by requestId: ${exactJobError.message}`)
    }

    let jobIdToUpdate = exactJob?.id

    if (!jobIdToUpdate) {
        const { data: fallbackJob, error: fallbackJobError } = await supabase
            .from('jobs')
            .select('id')
            .eq('transcript_id', transcriptId)
            .in('status', ['queued', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (fallbackJobError) {
            console.error('[webhook] Failed to lookup fallback job:', fallbackJobError)
            await markReceiptFailed(supabase, engine, requestId, activeAttemptId, fallbackJobError.message)
            throw new Error(`Failed to lookup fallback job: ${fallbackJobError.message}`)
        }

        jobIdToUpdate = fallbackJob?.id
    }

    // The owner names the folder the response is stored in.
    const { data: transcript, error: transcriptError } = await supabase
        .from('transcripts')
        .select('user_id')
        .eq('id', transcriptId)
        .maybeSingle()

    if (transcriptError) {
        console.error('[webhook] Failed to lookup transcript owner:', transcriptError)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, transcriptError.message)
        throw new Error(`Failed to lookup transcript owner: ${transcriptError.message}`)
    }

    if (!jobIdToUpdate || !transcript) {
        console.error('[webhook] No job found to store the response', { transcriptId, requestId })
        await persistWebhookFailure({
            supabase,
            transcriptId,
            requestId,
            engine,
            message: 'Transcription result received but its job was not found.',
        })
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, 'Job not found')
        throw new Error(`Job not found for ${engine} result`)
    }

    // Store the response, then link it. A redelivery overwrites the same file.
    const resultKey = getTranscriptionResultPath(transcript.user_id, transcriptId, jobIdToUpdate)
    try {
        await uploadTranscriptionResult(supabase, resultKey, rawBody)
    } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError)
        console.error(`[webhook] Failed to store ${engine} result:`, message)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, message)
        throw uploadError
    }

    const { data: linkedJob, error: updateError } = await supabase
        .from('jobs')
        .update({
            result_object_key: resultKey,
            inngest_event_id: requestId,
        })
        .eq('id', jobIdToUpdate)
        .select('id')
        .maybeSingle()

    if (updateError) {
        // The link may have landed; keep the file and let the retry overwrite it.
        console.error(`[webhook] Failed to link ${engine} result:`, updateError)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, updateError.message)
        throw new Error(`Failed to link ${engine} result: ${updateError.message}`)
    }

    if (!linkedJob) {
        // The job went with its transcript while the file was uploading.
        await removeTranscriptionResult(supabase, resultKey, 'webhook')
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, 'Job deleted during upload')
        throw new Error(`Job was deleted while storing the ${engine} result`)
    }

    // Forward to Inngest for durable processing
    try {
        await sendInngestEvent({
            name: 'transcription/webhook',
            data: { requestId, transcriptId },
        })
    } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError)
        console.error('[webhook] inngest.send failed after receipt claim:', message)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, message)
        throw sendError
    }

    // Finalize receipt
    const { error: finalizeError } = await supabase
        .from('webhook_receipts')
        .update({ status: 'completed', processed_at: new Date().toISOString() })
        .eq('provider', engine)
        .eq('request_id', requestId)
        .eq('attempt_id', activeAttemptId)

    if (finalizeError) {
        // Real work is done — leave as processing; lease expiry handles stale recovery
        console.error('[webhook] Finalize failed; receipt left as processing (will expire):', finalizeError)
    }

    return { outcome: 'processed', attemptId: activeAttemptId }
}

async function markReceiptFailed(
    supabase: SupabaseClient,
    engine: TranscriptionEngine,
    requestId: string,
    attemptId: string,
    message: string
): Promise<void> {
    try {
        await supabase
            .from('webhook_receipts')
            .update({
                status: 'failed',
                last_error: message.slice(0, 500),
            })
            .eq('provider', engine)
            .eq('request_id', requestId)
            .eq('attempt_id', attemptId)
    } catch {
        // Don't let receipt cleanup mask the original error
    }
}
